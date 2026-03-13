import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';

export default function ListingsSection({ stats }) {
    return (
        <div className="max-w-3xl">
            <div className="bg-white rounded-2xl border shadow-sm p-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                    <h3 className="text-lg font-bold text-gray-900">Marketplace Listings</h3>
                    <Link to="/sell" className="flex items-center gap-2 px-5 py-2 bg-green-500 text-white font-bold rounded-lg text-sm hover:bg-green-600 transition-colors">
                        <Plus className="w-4 h-4" /> New Listing
                    </Link>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                    <div className="bg-indigo-50 rounded-xl p-4 text-center">
                        <p className="text-2xl font-black text-indigo-600">{stats.listings?.active || 0}</p>
                        <p className="text-xs text-indigo-400 font-bold">Active</p>
                    </div>
                    <div className="bg-green-50 rounded-xl p-4 text-center">
                        <p className="text-2xl font-black text-green-600">{stats.listings?.sold || 0}</p>
                        <p className="text-xs text-green-400 font-bold">Sold</p>
                    </div>
                    <div className="bg-amber-50 rounded-xl p-4 text-center">
                        <p className="text-2xl font-black text-amber-600">{stats.listings?.totalViews || 0}</p>
                        <p className="text-xs text-amber-400 font-bold">Views</p>
                    </div>
                </div>

                <Link to="/my-listings"
                    className="block text-center py-3 border-2 border-dashed border-gray-200 rounded-xl text-indigo-600 font-bold text-sm hover:bg-indigo-50 hover:border-indigo-200 transition-colors">
                    Manage All Listings →
                </Link>
            </div>
        </div>
    );
}
