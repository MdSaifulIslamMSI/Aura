import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Mail } from 'lucide-react';
import { statusApi } from '@/services/api/statusApi';

const LEVELS = [
  { value: 'all', label: 'All incidents' },
  { value: 'major', label: 'Major incidents' },
  { value: 'maintenance', label: 'Maintenance only' },
];

export default function StatusSubscribePage() {
  const [searchParams] = useSearchParams();
  const unsubscribeToken = searchParams.get('unsubscribe') || '';
  const [payload, setPayload] = useState(null);
  const [email, setEmail] = useState('');
  const [notificationLevel, setNotificationLevel] = useState('all');
  const [selectedGroupIds, setSelectedGroupIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadStatus = useCallback(async () => {
    try {
      const data = await statusApi.getPublicStatus();
      setPayload(data);
      setSelectedGroupIds((data.groups || []).map((group) => group.id));
    } catch {
      setPayload({ groups: [] });
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const groups = useMemo(() => payload?.groups || [], [payload]);

  const submitSubscribe = async (event) => {
    event.preventDefault();
    try {
      setBusy(true);
      setError('');
      setMessage('');
      await statusApi.subscribe({ email, selectedGroupIds, notificationLevel });
      setMessage('Subscription saved.');
    } catch (err) {
      setError(err.message || 'Subscription failed');
    } finally {
      setBusy(false);
    }
  };

  const submitUnsubscribe = async () => {
    try {
      setBusy(true);
      setError('');
      setMessage('');
      await statusApi.unsubscribe(unsubscribeToken);
      setMessage('Unsubscribed from status updates.');
    } catch (err) {
      setError(err.message || 'Unsubscribe failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-950">
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 py-10 sm:px-6 md:py-14">
        <Link to="/status" className="inline-flex w-fit items-center gap-2 text-sm font-bold text-slate-600 hover:text-slate-950">
          <ArrowLeft className="h-4 w-4" />
          Status
        </Link>
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-950 text-white">
              <Mail className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-2xl font-extrabold tracking-normal text-slate-950">Subscribe to updates</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">Receive incident and maintenance notifications for selected Aura systems.</p>
            </div>
          </div>

          {unsubscribeToken ? (
            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-700">This link can remove the matching subscription.</p>
              <button
                type="button"
                disabled={busy}
                onClick={submitUnsubscribe}
                className="mt-4 rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
              >
                Unsubscribe
              </button>
            </div>
          ) : (
            <form onSubmit={submitSubscribe} className="mt-6 space-y-5">
              <label className="block">
                <span className="text-sm font-bold text-slate-700">Email</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-base text-slate-950 outline-none focus:border-slate-950"
                  placeholder="you@example.com"
                />
              </label>
              <fieldset>
                <legend className="text-sm font-bold text-slate-700">Notification type</legend>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {LEVELS.map((level) => (
                    <label key={level.value} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-3 text-sm font-bold ${notificationLevel === level.value ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-700'}`}>
                      <input
                        type="radio"
                        className="sr-only"
                        checked={notificationLevel === level.value}
                        onChange={() => setNotificationLevel(level.value)}
                      />
                      {level.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="text-sm font-bold text-slate-700">Components</legend>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {groups.map((group) => (
                    <label key={group.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={selectedGroupIds.includes(group.id)}
                        onChange={(event) => {
                          setSelectedGroupIds((prev) => event.target.checked
                            ? [...new Set([...prev, group.id])]
                            : prev.filter((id) => id !== group.id));
                        }}
                      />
                      {group.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-5 py-3 text-sm font-bold text-white disabled:opacity-60">
                <CheckCircle2 className="h-4 w-4" />
                Save subscription
              </button>
            </form>
          )}

          {message ? <p className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{message}</p> : null}
          {error ? <p className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</p> : null}
        </section>
      </div>
    </div>
  );
}
