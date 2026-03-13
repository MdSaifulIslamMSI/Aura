import { Lock, Activity, AlertTriangle, LogOut, Bell } from 'lucide-react';
import { Link } from 'react-router-dom';
import { TogglePref } from './ProfileShared';

export default function SettingsSection({ 
    profile, currentUser, handlePasswordReset, passwordResetting, hasOtpReadyIdentity, 
    trustHealthy, trustLoading, paymentMethodsSecured, trustStatus, logout 
}) {
    return (
        <div className="max-w-2xl space-y-6">
            {/* Security */}
            <div className="bg-white rounded-2xl border shadow-sm p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2"><Lock className="w-5 h-5 text-indigo-500" /> Security</h3>
                <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-gray-50 rounded-xl">
                        <div>
                            <p className="font-semibold text-gray-900 text-sm">Password</p>
                            <p className="text-xs text-gray-400">Managed through Firebase Authentication</p>
                        </div>
                        <button
                            onClick={handlePasswordReset}
                            disabled={passwordResetting}
                            className="px-4 py-2 text-indigo-600 font-bold text-sm border border-indigo-200 rounded-lg hover:bg-indigo-50 disabled:opacity-60"
                        >
                            {passwordResetting ? 'Sending...' : 'Send Reset Link'}
                        </button>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-gray-50 rounded-xl">
                        <div>
                            <p className="font-semibold text-gray-900 text-sm">Two-Factor Auth</p>
                            <p className="text-xs text-gray-400">
                                {hasOtpReadyIdentity
                                    ? 'OTP sign-in is ready for your account'
                                    : 'Add a valid phone number to enable OTP sign-in'}
                            </p>
                        </div>
                        <span className={`px-3 py-1 text-xs font-bold rounded-full ${hasOtpReadyIdentity ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                            {hasOtpReadyIdentity ? 'Active' : 'Incomplete'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Trust Command Center */}
            <div className="bg-white rounded-2xl border shadow-sm p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <Activity className="w-5 h-5 text-indigo-500" />
                    Trust & Security Command Center
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                    <div className={`rounded-xl border p-4 ${trustHealthy ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                        <p className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Platform Status</p>
                        <p className={`text-sm font-bold mt-1 ${trustHealthy ? 'text-emerald-700' : 'text-amber-700'}`}>
                            {trustLoading ? 'Checking...' : trustHealthy ? 'Healthy' : 'Degraded'}
                        </p>
                    </div>
                    <div className={`rounded-xl border p-4 ${hasOtpReadyIdentity ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                        <p className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Identity Posture</p>
                        <p className={`text-sm font-bold mt-1 ${hasOtpReadyIdentity ? 'text-emerald-700' : 'text-amber-700'}`}>
                            {hasOtpReadyIdentity ? 'Fortified' : 'Needs Attention'}
                        </p>
                    </div>
                    <div className={`rounded-xl border p-4 ${paymentMethodsSecured ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                        <p className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Payment Safety</p>
                        <p className={`text-sm font-bold mt-1 ${paymentMethodsSecured ? 'text-emerald-700' : 'text-amber-700'}`}>
                            {paymentMethodsSecured ? 'Tokenized' : 'Review Needed'}
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Link to="/security" className="px-4 py-2.5 text-sm font-bold border border-indigo-200 rounded-lg text-indigo-700 hover:bg-indigo-50 text-center">Security Policy</Link>
                    <Link to="/privacy" className="px-4 py-2.5 text-sm font-bold border border-indigo-200 rounded-lg text-indigo-700 hover:bg-indigo-50 text-center">Privacy Policy</Link>
                </div>
            </div>

            {/* Notifications */}
            <div className="bg-white rounded-2xl border shadow-sm p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2"><Bell className="w-5 h-5 text-indigo-500" /> Notifications</h3>
                <div className="space-y-3">
                    <TogglePref label="Order Updates" desc="Get notified about order status" on={true} setOn={()=>{}} />
                    <TogglePref label="Marketplace" desc="Notifs about your listings" on={true} setOn={()=>{}} />
                </div>
            </div>

            {/* Danger Zone */}
            <div className="bg-white rounded-2xl border border-red-200 shadow-sm p-6">
                <h3 className="text-lg font-bold text-red-600 mb-4 flex items-center gap-2"><AlertTriangle className="w-5 h-5" /> Danger Zone</h3>
                <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-red-50 rounded-xl">
                        <div>
                            <p className="font-semibold text-gray-900 text-sm">Log Out</p>
                            <p className="text-xs text-gray-400">Sign out of your account</p>
                        </div>
                        <button onClick={logout} className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white font-bold text-sm rounded-lg hover:bg-red-600 transition-colors">
                            <LogOut className="w-4 h-4" /> Log Out
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
