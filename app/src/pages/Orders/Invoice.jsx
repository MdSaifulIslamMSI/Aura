import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { orderApi } from '@/services/api';
import { useMarket } from '@/context/MarketContext';
import { Loader2, Printer, ArrowLeft } from 'lucide-react';
import { useStableIcuMessages } from '@/i18n/useStableIcuMessages';

// Print-friendly invoice view. Zero new dependencies: the browser's print
// pipeline renders it (Ctrl+P / window.print), and @media print rules strip
// the app chrome. The owner-scoped receipt endpoint supplies the data — its
// shape is { orderId, orderedAt, status, payment{method}, amount{total},
// items[{title,quantity,unitPrice}], shippingAddress }.
const Invoice = () => {
    const { orderId } = useParams();
    const [receipt, setReceipt] = useState(null);
    const [error, setError] = useState('');
    const { t: legacyT, formatPrice } = useMarket();
    const t = useStableIcuMessages(legacyT);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const data = await orderApi.getReceipt(orderId);
                if (!cancelled) setReceipt(data || {});
            } catch (loadError) {
                if (!cancelled) setError(loadError.message || t('orders.invoice.error', {}, 'Unable to load this invoice.'));
            }
        };
        load();
        return () => {
            cancelled = true;
        };
    }, [orderId, t]);

    const items = Array.isArray(receipt?.items) ? receipt.items : [];
    const address = receipt?.shippingAddress || {};
    const money = (value) => formatPrice(Number(value || 0));

    return (
        <div className="orders-theme-shell min-h-screen bg-zinc-950 text-white">
            <div className="invoice-print-root mx-auto max-w-3xl px-6 py-10">
                <div className="invoice-no-print mb-8 flex items-center justify-between">
                    <Link
                        to={`/orders?focus=${encodeURIComponent(String(orderId || ''))}&expand=1`}
                        className="inline-flex items-center gap-2 text-sm font-bold text-slate-300 hover:text-white"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        {t('orders.invoice.back', {}, 'Back to order')}
                    </Link>
                    <button
                        type="button"
                        onClick={() => window.print()}
                        className="btn-primary inline-flex items-center gap-2 px-5 py-2.5"
                    >
                        <Printer className="h-4 w-4" />
                        {t('orders.invoice.print', {}, 'Print / Save as PDF')}
                    </button>
                </div>

                {error && (
                    <div role="alert" className="rounded-2xl border border-neo-rose/40 bg-neo-rose/10 p-6 text-neo-rose">
                        {error}
                    </div>
                )}

                {!receipt && !error && (
                    <div className="flex items-center justify-center gap-3 py-24 text-slate-400" aria-busy="true">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        {t('orders.invoice.loading', {}, 'Preparing invoice...')}
                    </div>
                )}

                {receipt && (
                    <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-glass">
                        <header className="mb-8 flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-6">
                            <div>
                                <h1 className="text-2xl font-black tracking-tight">
                                    {t('orders.invoice.title', {}, 'Invoice')}
                                </h1>
                                <p className="mt-1 text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                                    {t('orders.invoice.orderId', {}, 'Order')} #{String(receipt.orderId || orderId || '').slice(-8).toUpperCase()}
                                </p>
                            </div>
                            <div className="text-right text-sm text-slate-300">
                                <p className="font-black text-white">{money(receipt.amount?.total)}</p>
                                <p>
                                    {t('orders.invoice.placedOn', {}, 'Placed on')}{' '}
                                    {receipt.orderedAt ? String(receipt.orderedAt).slice(0, 10) : '—'}
                                </p>
                                <p>
                                    {t('orders.invoice.payment', {}, 'Payment')}: {String(receipt.payment?.method || '—')}
                                </p>
                            </div>
                        </header>

                        <section className="mb-8">
                            <h2 className="mb-3 text-xs font-black uppercase tracking-[0.24em] text-slate-400">
                                {t('orders.invoice.items', {}, 'Items')}
                            </h2>
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-white/10 text-left text-[10px] uppercase tracking-widest text-slate-500">
                                        <th className="py-2">{t('orders.invoice.item', {}, 'Item')}</th>
                                        <th className="py-2 text-right">{t('orders.qty', {}, 'Qty')}</th>
                                        <th className="py-2 text-right">{t('orders.invoice.amount', {}, 'Amount')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.map((item, index) => (
                                        <tr key={index} className="border-b border-white/5">
                                            <td className="py-3 pr-4">{item.title}</td>
                                            <td className="py-3 text-right">{item.quantity}</td>
                                            <td className="py-3 text-right">{money(Number(item.unitPrice) * Number(item.quantity || 1))}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </section>

                        <section className="grid gap-8 md:grid-cols-2">
                            <div>
                                <h2 className="mb-3 text-xs font-black uppercase tracking-[0.24em] text-slate-400">
                                    {t('orders.invoice.deliveryTo', {}, 'Delivery address')}
                                </h2>
                                <address className="not-italic text-sm leading-relaxed text-slate-300">
                                    {address?.address}
                                    <br />
                                    {address?.city}, {address?.postalCode}
                                    <br />
                                    {address?.country}
                                </address>
                            </div>
                            <div className="text-sm md:text-right">
                                <p className="flex justify-between border-t border-white/10 pt-3 text-base font-black md:justify-end md:gap-8">
                                    <span>{t('orders.invoice.total', {}, 'Total')}</span>
                                    <span>{money(receipt.amount?.total)}</span>
                                </p>
                            </div>
                        </section>

                        <footer className="mt-8 border-t border-white/10 pt-4 text-[11px] text-slate-500">
                            {t('orders.invoice.footer', {}, 'This invoice was generated from your Aura order record.')}
                        </footer>
                    </article>
                )}
            </div>
            <style>{`
                @media print {
                    .invoice-no-print { display: none !important; }
                    body { background: #fff !important; }
                    .invoice-print-root { max-width: none; padding: 0; color: #111 !important; }
                    .orders-theme-shell { background: #fff !important; }
                    .orders-theme-shell * { color: #111 !important; border-color: #ddd !important; }
                    .orders-theme-shell article { background: #fff !important; border: 1px solid #ddd !important; box-shadow: none !important; }
                }
            `}</style>
        </div>
    );
};

export default Invoice;
