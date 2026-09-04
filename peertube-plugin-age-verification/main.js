async function register({
  registerHook,
  registerSetting,
  settingsManager,
  storageManager,
  peertubeHelpers
}) {
  const logger = peertubeHelpers.logger

  logger.info('Registering Age Verification Plugin')

  // Plugin settings for admin configuration
  registerSetting({
    private: false,
    name: 'enabled',
    label: 'Enable age verification',
    type: 'input-checkbox',
    default: true,
    descriptionHTML: 'Show age verification popup for new visitors'
  })

  registerSetting({
    private: false,
    name: 'minimum-age',
    label: 'Minimum age required',
    type: 'input',
    default: '18',
    descriptionHTML: 'Minimum age required to access the content (must be a number between 13-99)'
  })

  registerSetting({
    private: false,
    name: 'verification-title',
    label: 'Verification popup title',
    type: 'input',
    default: 'Age Verification Required',
    descriptionHTML: 'Title displayed in the age verification popup'
  })

  registerSetting({
    private: false,
    name: 'verification-message',
    label: 'Verification message',
    type: 'input-textarea',
    default: 'This website contains age-restricted content. You must be {age} years or older to access this content.',
    descriptionHTML: 'Message displayed in the popup. Use {age} placeholder for the minimum age.'
  })

  registerSetting({
    private: false,
    name: 'redirect-url',
    label: 'Redirect URL for underage users',
    type: 'input',
    default: 'https://www.google.com',
    descriptionHTML: 'URL to redirect users who select "No, I am under {age}"'
  })

  registerSetting({
    private: false,
    name: 'verification-expiry-days',
    label: 'Verification expiry (days)',
    type: 'input',
    default: '30',
    descriptionHTML: 'Number of days before asking for age verification again'
  })

  registerSetting({
    private: false,
    name: 'apply-blur-effect',
    label: 'Apply blur effect to background',
    type: 'input-checkbox',
    default: true,
    descriptionHTML: 'Apply PeerTube\'s blur effect to the background while showing the popup'
  })

  registerSetting({
    private: false,
    name: 'block-navigation',
    label: 'Block navigation until verified',
    type: 'input-checkbox',
    default: true,
    descriptionHTML: 'Prevent users from navigating the site until age verification is completed'
  })

  // Hook into application initialization
  registerHook({
    target: 'action:application.init',
    handler: () => {
      logger.info('Age verification plugin initialized on application start')
    }
  })

  // Hook into router navigation to potentially re-check verification
  registerHook({
    target: 'action:router.navigation-end',
    handler: (params) => {
      logger.debug('Navigation detected:', params.path)
    }
  })

  // Settings change handler
  settingsManager.onSettingsChange(settings => {
    logger.info('Age verification plugin settings changed:', Object.keys(settings))
    
    // Validate critical settings
    const minimumAge = Number.parseInt(settings['minimum-age'] || '18', 10)
    if (Number.isNaN(minimumAge) || minimumAge < 13 || minimumAge > 99) {
      logger.warn('Invalid minimum age setting:', settings['minimum-age'])
    }
    
    const expiryDays = Number.parseInt(settings['verification-expiry-days'] || '30', 10)
    if (Number.isNaN(expiryDays) || expiryDays < 1 || expiryDays > 365) {
      logger.warn('Invalid expiry days setting:', settings['verification-expiry-days'])
    }
  })

  logger.info('Age Verification Plugin registered successfully')
}

async function unregister() {
  // Plugin cleanup - this function is called when plugin is disabled/uninstalled
  return
}

module.exports = {
  register,
  unregister
}