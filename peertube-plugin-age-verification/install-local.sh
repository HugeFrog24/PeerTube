#!/bin/bash

# Age Verification Plugin - Local Installation Script
# Based on PeerTube official documentation

set -e

PLUGIN_NAME="peertube-plugin-age-verification"
PLUGIN_PATH=$(pwd)

echo "🔧 Installing Age Verification Plugin locally..."
echo "Plugin path: $PLUGIN_PATH"

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Run this script from the plugin directory."
    exit 1
fi

# Check if PeerTube is running (optional check)
if command -v peertube-cli &> /dev/null; then
    echo "✅ PeerTube CLI found"
    
    # Method 1: Using PeerTube CLI (if available)
    echo "📦 Installing plugin using PeerTube CLI..."
    peertube-cli plugins install --path "$PLUGIN_PATH"
    
elif [ -f "../server/scripts/plugin/install.ts" ]; then
    echo "✅ PeerTube development environment detected"
    
    # Method 2: Using PeerTube development scripts
    echo "📦 Installing plugin using PeerTube development scripts..."
    cd ..
    npm run plugin:install -- --plugin-path "$PLUGIN_PATH"
    
elif [ -f "../dist/server/scripts/plugin/install.js" ]; then
    echo "✅ PeerTube production environment detected"
    
    # Method 3: Using compiled PeerTube scripts
    echo "📦 Installing plugin using compiled PeerTube scripts..."
    cd ..
    node dist/server/scripts/plugin/install.js --plugin-path "$PLUGIN_PATH"
    
else
    echo "❌ Error: PeerTube installation not found."
    echo "Please run this script from within your PeerTube directory structure."
    echo ""
    echo "Manual installation options:"
    echo "1. Copy plugin to: /path/to/peertube/storage/plugins/node_modules/$PLUGIN_NAME"
    echo "2. Use PeerTube admin interface to upload plugin as ZIP"
    echo "3. Install PeerTube CLI: npm install -g @peertube/peertube-cli"
    exit 1
fi

echo ""
echo "✅ Plugin installation completed!"
echo ""
echo "📋 Next steps:"
echo "1. Go to your PeerTube admin panel"
echo "2. Navigate to Administration → Settings → Plugins"
echo "3. Find 'Age Verification' and click 'Enable'"
echo "4. Configure the plugin settings as needed"
echo "5. Clear browser storage and refresh to test: localStorage.clear()"
echo ""
echo "🧪 Testing commands:"
echo "# Clear verification to test again:"
echo "localStorage.removeItem('peertube-age-verification-status')"
echo ""
echo "# Check stored verification:"
echo "console.log(localStorage.getItem('peertube-age-verification-status'))"
echo "console.log(localStorage.getItem('peertube-age-verification-expiry'))"