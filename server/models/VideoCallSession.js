const mongoose = require('mongoose');

const VIDEO_CALL_STATUS = ['ringing', 'connected', 'ended', 'declined', 'failed', 'missed'];

const videoCallSessionSchema = new mongoose.Schema({
    sessionKey: {
        type: String,
        required: true,
        unique: true,
        index: true,
        trim: true,
    },
    listing: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Listing',
        required: true,
        index: true,
    },
    participants: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    }],
    initiator: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    status: {
        type: String,
        enum: VIDEO_CALL_STATUS,
        default: 'ringing',
        index: true,
    },
    startedAt: {
        type: Date,
        default: Date.now,
    },
    connectedAt: {
        type: Date,
        default: null,
    },
    endedAt: {
        type: Date,
        default: null,
    },
    lastSignalAt: {
        type: Date,
        default: null,
    },
    lastEventAt: {
        type: Date,
        default: Date.now,
    },
    endReason: {
        type: String,
        default: '',
        maxlength: 80,
    },
    expiresAt: {
        type: Date,
        required: true,
    },
}, {
    timestamps: true,
});

videoCallSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
videoCallSessionSchema.index({ listing: 1, status: 1, lastEventAt: -1 });

module.exports = mongoose.model('VideoCallSession', videoCallSessionSchema);
