const mongoose = require('mongoose');

const appConfigSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
  },
  value: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  description: String,
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

const AppConfig = mongoose.model('AppConfig', appConfigSchema);

// Default config values
AppConfig.getDefaults = () => [
  { key: 'maintenance_mode', value: false, description: 'Enable/disable maintenance mode' },
  { key: 'allow_registration', value: true, description: 'Allow new user registrations' },
  { key: 'max_message_length', value: 2000, description: 'Max characters per message' },
  { key: 'giphy_enabled', value: true, description: 'Enable Giphy GIF search' },
  { key: 'file_upload_enabled', value: true, description: 'Enable file uploads' },
  { key: 'welcome_message', value: 'Welcome to Rylac App! 🎉', description: 'Welcome message for new users' },
  { key: 'app_version', value: '1.0.0', description: 'Current app version' },
];

module.exports = AppConfig;
