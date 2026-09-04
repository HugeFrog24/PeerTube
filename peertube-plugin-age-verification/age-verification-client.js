export function register({ registerHook, peertubeHelpers }) {
  // Use PeerTube's storage naming convention
  const STORAGE_KEYS = {
    AGE_VERIFICATION_STATUS: 'peertube-age-verification-status',
    AGE_VERIFICATION_EXPIRY: 'peertube-age-verification-expiry',
    AGE_VERIFICATION_TIMESTAMP: 'peertube-age-verification-timestamp'
  }

  let isVerificationInProgress = false
  let pageBlurApplied = false

  // Hook into application initialization - this is where we check age verification
  registerHook({
    target: 'action:application.init',
    handler: () => {
      // Wait for DOM and PeerTube to be fully ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          setTimeout(() => checkAgeVerification(), 500)
        })
      } else {
        setTimeout(() => checkAgeVerification(), 500)
      }
    }
  })

  // Hook into router navigation to maintain verification state
  registerHook({
    target: 'action:router.navigation-end',
    handler: (params) => {
      // Only check on navigation if blocking is enabled and user isn't verified
      checkNavigationBlocking(params.path)
    }
  })

  async function checkAgeVerification() {
    if (isVerificationInProgress) return

    try {
      // Validate peertubeHelpers exists
      if (!peertubeHelpers?.getSettings) {
        console.error('[Age Verification] PeerTube helpers not available')
        return
      }

      // Get plugin settings
      const settings = await peertubeHelpers.getSettings()
      
      // Check if plugin is enabled
      if (!settings?.enabled) {
        console.log('[Age Verification] Plugin is disabled')
        return
      }

      // Validate settings
      if (!validateSettings(settings)) {
        console.error('[Age Verification] Invalid plugin settings')
        return
      }

      // Check if user is already verified and verification hasn't expired
      if (isUserVerified(settings)) {
        console.log('[Age Verification] User already verified')
        return
      }

      console.log('[Age Verification] Showing age verification popup')
      await showAgeVerificationModal(settings)

    } catch (error) {
      console.error('[Age Verification] Error during age verification check:', error)
      // Reset state on error
      isVerificationInProgress = false
      removePageBlur()
      unblockPageNavigation()
    }
  }

  function validateSettings(settings) {
    const minimumAge = Number.parseInt(settings['minimum-age'] || '18', 10)
    if (Number.isNaN(minimumAge) || minimumAge < 13 || minimumAge > 99) {
      console.error('[Age Verification] Invalid minimum age:', settings['minimum-age'])
      return false
    }

    const expiryDays = Number.parseInt(settings['verification-expiry-days'] || '30', 10)
    if (Number.isNaN(expiryDays) || expiryDays < 1 || expiryDays > 365) {
      console.error('[Age Verification] Invalid expiry days:', settings['verification-expiry-days'])
      return false
    }

    const redirectUrl = settings['redirect-url']
    if (redirectUrl && !isValidUrl(redirectUrl)) {
      console.error('[Age Verification] Invalid redirect URL:', redirectUrl)
      return false
    }

    return true
  }

  function isUserVerified(settings) {
    const verificationStatus = getFromStorage(STORAGE_KEYS.AGE_VERIFICATION_STATUS)
    const verificationExpiry = getFromStorage(STORAGE_KEYS.AGE_VERIFICATION_EXPIRY)
    
    if (verificationStatus !== 'verified' || !verificationExpiry) {
      return false
    }

    const expiryTime = Number.parseInt(verificationExpiry, 10)
    const currentTime = Date.now()
    
    if (currentTime > expiryTime) {
      console.log('[Age Verification] Verification expired, clearing storage')
      clearVerificationData()
      return false
    }

    return true
  }

  async function showAgeVerificationModal(settings) {
    if (isVerificationInProgress) return
    isVerificationInProgress = true

    const minimumAge = settings['minimum-age'] || '18'
    const title = settings['verification-title'] || 'Age Verification Required'
    const messageTemplate = settings['verification-message'] || 
      'This website contains age-restricted content. You must be {age} years or older to access this content.'
    const message = (await safeTranslate(messageTemplate)).replaceAll('{age}', minimumAge)
    const redirectUrl = settings['redirect-url'] || 'https://www.google.com'
    const applyBlur = settings['apply-blur-effect'] === true || settings['apply-blur-effect'] === undefined
    const blockNavigation = settings['block-navigation'] === true || settings['block-navigation'] === undefined

    // Apply blur effect using PeerTube's existing blur system
    if (applyBlur) {
      applyPageBlur()
    }

    // Block navigation if enabled
    if (blockNavigation) {
      blockPageNavigation()
    }

    try {
      // Validate peertubeHelpers exists
      if (!peertubeHelpers?.showModal) {
        throw new Error('PeerTube helpers not available')
      }

      // Use PeerTube's built-in modal system with stock styling
      peertubeHelpers.showModal({
        title: await safeTranslate(title),
        content: `
          <div style="text-align: center; padding: 1rem 0;">
            <p style="font-size: 1.1rem; margin-bottom: 1.5rem; line-height: 1.5;">
              ${escapeHtml(message)}
            </p>
            <p style="color: var(--fg-300); font-size: 0.9rem; margin-bottom: 0;">
              ${await safeTranslate('Please confirm your age to continue.')}
            </p>
          </div>
        `,
        close: false, // Prevent closing without making a choice
        cancel: {
          value: (await safeTranslate('No, I am under {age}')).replaceAll('{age}', minimumAge),
          action: () => {
            handleUnderage(redirectUrl)
          }
        },
        confirm: {
          value: (await safeTranslate('Yes, I am {age} or older')).replaceAll('{age}', minimumAge),
          action: async () => {
            await handleAgeVerified(settings)
          }
        }
      })
    } catch (error) {
      console.error('[Age Verification] Error showing modal:', error)
      isVerificationInProgress = false
      removePageBlur()
      unblockPageNavigation()
    }
  }

  function handleUnderage(redirectUrl) {
    console.log('[Age Verification] User confirmed underage, redirecting')
    
    // Store the rejection for analytics (optional)
    setInStorage(STORAGE_KEYS.AGE_VERIFICATION_STATUS, 'rejected')
    setInStorage(STORAGE_KEYS.AGE_VERIFICATION_TIMESTAMP, Date.now().toString())
    
    // Redirect to external URL
    window.location.href = redirectUrl
  }

  async function handleAgeVerified(settings) {
    console.log('[Age Verification] User confirmed age verification')
    
    const expiryDays = Number.parseInt(settings['verification-expiry-days'] || '30', 10)
    const expiryTime = Date.now() + (expiryDays * 24 * 60 * 60 * 1000)
    
    // Store verification with expiry
    setInStorage(STORAGE_KEYS.AGE_VERIFICATION_STATUS, 'verified')
    setInStorage(STORAGE_KEYS.AGE_VERIFICATION_EXPIRY, expiryTime.toString())
    setInStorage(STORAGE_KEYS.AGE_VERIFICATION_TIMESTAMP, Date.now().toString())
    
    // Remove blur and navigation blocking
    removePageBlur()
    unblockPageNavigation()
    
    // Reset verification state
    isVerificationInProgress = false
    
    // Show success notification
    if (peertubeHelpers.notifier) {
      peertubeHelpers.notifier.success(
        await safeTranslate('Age verification completed. Welcome!')
      )
    }
  }

  function applyPageBlur() {
    if (pageBlurApplied) return
    
    // Create style element with PeerTube's existing blur effect
    const style = document.createElement('style')
    style.id = 'age-verification-blur-style'
    style.textContent = `
      .age-verification-blur-active {
        filter: var(--thumbnailBlur, blur(8px)) !important;
        pointer-events: none !important;
        user-select: none !important;
        transition: filter 0.3s ease;
      }
      
      /* Ensure modal is not blurred */
      ngb-modal-window,
      .modal,
      .modal-backdrop {
        filter: none !important;
        pointer-events: auto !important;
      }
    `
    document.head.appendChild(style)
    
    // Apply blur to main application content
    const mainContent = document.querySelector('my-app')
    if (mainContent) {
      mainContent.classList.add('age-verification-blur-active')
      pageBlurApplied = true
      console.log('[Age Verification] Applied page blur effect')
    }
  }

  function removePageBlur() {
    if (!pageBlurApplied) return
    
    const mainContent = document.querySelector('my-app')
    if (mainContent) {
      mainContent.classList.remove('age-verification-blur-active')
    }
    
    const style = document.getElementById('age-verification-blur-style')
    if (style) {
      style.remove()
    }
    
    pageBlurApplied = false
    console.log('[Age Verification] Removed page blur effect')
  }

  let navigationBlockHandlers = []

  function blockPageNavigation() {
    // These listeners run in the capture phase, so anything they stop never
    // reaches its target. The verification modal is rendered outside <my-app>
    // (ng-bootstrap appends it to <body>) and its buttons rely on their own
    // click listeners, so events inside the modal must be let through -- else
    // the "Yes"/"No" buttons do nothing at all.
    const isInsideModal = (target) => {
      return target instanceof Element && target.closest('ngb-modal-window, .modal') !== null
    }

    // Add event listeners to prevent navigation
    const blockNavigation = (event) => {
      if (isVerificationInProgress && !isInsideModal(event.target)) {
        event.preventDefault()
        event.stopPropagation()
        return false
      }
    }

    const blockKeyboard = (event) => {
      if (isVerificationInProgress && !isInsideModal(event.target)) {
        // Allow only Tab, Enter, and Escape for modal interaction
        if (!['Tab', 'Enter', 'Escape'].includes(event.key)) {
          event.preventDefault()
          event.stopPropagation()
        }
      }
    }

    // Store references for cleanup
    navigationBlockHandlers = [
      { element: document, event: 'click', handler: blockNavigation, options: true },
      { element: document, event: 'keydown', handler: blockKeyboard, options: true }
    ]

    // Block clicks on navigation elements
    document.addEventListener('click', blockNavigation, true)
    
    // Block keyboard navigation
    document.addEventListener('keydown', blockKeyboard, true)

  }

  function unblockPageNavigation() {
    // Remove all stored event listeners
    navigationBlockHandlers.forEach(({ element, event, handler, options }) => {
      element.removeEventListener(event, handler, options)
    })
    navigationBlockHandlers = []
    console.log('[Age Verification] Navigation blocking disabled')
  }

  function checkNavigationBlocking(path) {
    // If verification is in progress and blocking is enabled, prevent navigation
    if (isVerificationInProgress) {
      console.log('[Age Verification] Navigation blocked due to pending verification')
      return false
    }
    return true
  }

  // Storage helper functions using browser localStorage
  // (PeerTube's peertubeLocalStorage is not available in plugin context)
  function getFromStorage(key) {
    try {
      return localStorage.getItem(key)
    } catch (error) {
      console.error('[Age Verification] Error reading from storage:', error)
      return null
    }
  }

  function setInStorage(key, value) {
    try {
      localStorage.setItem(key, value)
    } catch (error) {
      console.error('[Age Verification] Error writing to storage:', error)
    }
  }

  function clearVerificationData() {
    try {
      localStorage.removeItem(STORAGE_KEYS.AGE_VERIFICATION_STATUS)
      localStorage.removeItem(STORAGE_KEYS.AGE_VERIFICATION_EXPIRY)
      localStorage.removeItem(STORAGE_KEYS.AGE_VERIFICATION_TIMESTAMP)
    } catch (error) {
      console.error('[Age Verification] Error clearing storage:', error)
    }
  }

  // Helper function for safe translation with fallback
  async function safeTranslate(text) {
    try {
      if (peertubeHelpers?.translate) {
        return await peertubeHelpers.translate(text)
      }
    } catch (error) {
      console.warn('[Age Verification] Translation failed for:', text, error)
    }
    return text // Fallback to original text
  }

  console.log('[Age Verification] Client plugin registered successfully')
}

// Pure helpers, kept at module scope: they close over nothing in register()
function isValidUrl(string) {
  try {
    new URL(string)
    return true
  } catch {
    // Not a URL the browser can parse, which is all the caller asks
    return false
  }
}

// Escape HTML by round-tripping through a text node
function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}
