const mongoose = require('mongoose');

const MAINTENANCE_STATUSES = [
    'scheduled',
    'in_progress',
    'completed',
    'cancelled',
];

const maintenanceWindowSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true, maxlength: 180 },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true, maxlength: 220 },
    status: { type: String, enum: MAINTENANCE_STATUSES, default: 'scheduled', index: true },
    affectedComponentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'StatusComponent', index: true }],
    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, required: true, index: true },
    publicMessage: { type: String, default: '', trim: true, maxlength: 5000 },
    internalNotes: { type: String, default: '', trim: true, maxlength: 10000 },
    notifySubscribers: { type: Boolean, default: true },
    isPublic: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

maintenanceWindowSchema.index({ isPublic: 1, status: 1, startsAt: 1 });
maintenanceWindowSchema.index({ affectedComponentIds: 1, startsAt: 1 });

maintenanceWindowSchema.virtual('affectedComponents')
    .get(function getAffectedComponents() {
        return this.affectedComponentIds;
    })
    .set(function setAffectedComponents(value) {
        this.affectedComponentIds = value;
    });

module.exports = mongoose.model('MaintenanceWindow', maintenanceWindowSchema);
module.exports.MAINTENANCE_STATUSES = MAINTENANCE_STATUSES;
