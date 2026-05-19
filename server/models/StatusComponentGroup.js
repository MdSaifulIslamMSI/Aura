const mongoose = require('mongoose');

const statusComponentGroupSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true, maxlength: 140 },
    description: { type: String, default: '', trim: true, maxlength: 500 },
    order: { type: Number, default: 0, index: true },
    isPublic: { type: Boolean, default: true, index: true },
}, { timestamps: true });

statusComponentGroupSchema.index({ isPublic: 1, order: 1, name: 1 });

module.exports = mongoose.model('StatusComponentGroup', statusComponentGroupSchema);
