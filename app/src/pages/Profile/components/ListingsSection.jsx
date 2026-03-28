import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useMarket } from '@/context/MarketContext';

export default function ListingsSection({ stats }) {
    const { t } = useMarket();

    return (
        <div className="max-w-3xl">
            <div className="rounded-2xl border bg-white p-6 shadow-sm">
                <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="text-lg font-bold text-gray-900">{t('profile.listings.title', {}, 'Marketplace Listings')}</h3>
                    <Link to="/sell" className="flex items-center gap-2 rounded-lg bg-green-500 px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-green-600">
                        <Plus className="h-4 w-4" /> {t('profile.listings.new', {}, 'New Listing')}
                    </Link>
                </div>

                <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="rounded-xl bg-indigo-50 p-4 text-center">
                        <p className="text-2xl font-black text-indigo-600">{stats.listings?.active || 0}</p>
                        <p className="text-xs font-bold text-indigo-400">{t('profile.listings.active', {}, 'Active')}</p>
                    </div>
                    <div className="rounded-xl bg-green-50 p-4 text-center">
                        <p className="text-2xl font-black text-green-600">{stats.listings?.sold || 0}</p>
                        <p className="text-xs font-bold text-green-400">{t('profile.listings.sold', {}, 'Sold')}</p>
                    </div>
                    <div className="rounded-xl bg-amber-50 p-4 text-center">
                        <p className="text-2xl font-black text-amber-600">{stats.listings?.totalViews || 0}</p>
                        <p className="text-xs font-bold text-amber-400">{t('profile.listings.views', {}, 'Views')}</p>
                    </div>
                </div>

                <Link
                    to="/my-listings"
                    className="block rounded-xl border-2 border-dashed border-gray-200 py-3 text-center text-sm font-bold text-indigo-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50"
                >
                    {t('profile.listings.manageAll', {}, 'Manage All Listings')} →
                </Link>
            </div>
        </div>
    );
}
