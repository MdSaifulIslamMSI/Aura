import { User, Mail, Phone, Edit3, Save, Calendar } from 'lucide-react';
import PremiumSelect from '@/components/ui/premium-select';
import { InfoRow } from './ProfileShared';

export default function PersonalInfoSection({ profile, profileName, profileEmail, profilePhone, editMode, setEditMode, editForm, setEditForm, saving, handleSaveProfile, createEditForm }) {
    return (
        <div className="max-w-2xl">
            <div className="bg-white rounded-2xl border shadow-sm p-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                    <h3 className="text-lg font-bold text-gray-900">Personal Information</h3>
                    {editMode ? (
                        <div className="flex gap-2">
                            <button onClick={() => { setEditMode(false); setEditForm(createEditForm(profile)); }}
                                className="px-4 py-2 border rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50">
                                Cancel
                            </button>
                            <button onClick={handleSaveProfile} disabled={saving}
                                className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white font-bold rounded-lg text-sm hover:bg-indigo-700 transition-colors disabled:opacity-50">
                                {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                                Save
                            </button>
                        </div>
                    ) : (
                        <button onClick={() => setEditMode(true)}
                            className="flex items-center gap-2 px-4 py-2 text-indigo-600 font-bold text-sm border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors">
                            <Edit3 className="w-4 h-4" /> Edit
                        </button>
                    )}
                </div>

                <div className="space-y-5">
                    <InfoRow icon={User} label="Full Name"
                        value={editMode ? (
                            <input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                                className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 outline-none" />
                        ) : (profileName || 'Not set')} />

                    <InfoRow icon={Mail} label="Email Address"
                        value={profileEmail || 'Not set'}
                        badge="Cannot be changed" />

                    <InfoRow icon={Phone} label="Phone Number"
                        value={editMode ? (
                            <input value={editForm.phone} onChange={e => setEditForm(p => ({ ...p, phone: e.target.value }))}
                                className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 outline-none" />
                        ) : (profilePhone || 'Not set')} />

                    <InfoRow icon={User} label="Gender"
                        value={editMode ? (
                            <PremiumSelect value={editForm.gender} onChange={e => setEditForm(p => ({ ...p, gender: e.target.value }))}
                                className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 outline-none bg-white">
                                <option value="">Prefer not to say</option>
                                <option value="male">Male</option>
                                <option value="female">Female</option>
                                <option value="other">Other</option>
                            </PremiumSelect>
                        ) : (profile?.gender ? profile.gender.charAt(0).toUpperCase() + profile.gender.slice(1) : 'Not specified')} />

                    <InfoRow icon={Calendar} label="Date of Birth"
                        value={editMode ? (
                            <input type="date" value={editForm.dob} onChange={e => setEditForm(p => ({ ...p, dob: e.target.value }))}
                                className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 outline-none" />
                        ) : (profile?.dob ? new Date(profile.dob).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Not set')} />

                    <InfoRow icon={Edit3} label="Bio"
                        value={editMode ? (
                            <textarea value={editForm.bio} onChange={e => setEditForm(p => ({ ...p, bio: e.target.value }))}
                                maxLength={200} rows={3} placeholder="Tell us about yourself..."
                                className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 outline-none resize-none" />
                        ) : (profile?.bio || 'No bio added')} />
                </div>
            </div>
        </div>
    );
}
