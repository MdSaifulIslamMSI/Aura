import { statusMeta } from './statusMeta';

export default function UptimeBars({ history = [], compact = false, label = 'Uptime history' }) {
  const bars = Array.isArray(history) ? history.slice(-90) : [];

  return (
    <div className="min-w-0" aria-label={label}>
      <div className="flex items-end gap-[3px] overflow-x-auto pb-1" role="list" aria-label={label}>
        {bars.map((entry, index) => {
          const meta = statusMeta(entry?.status || 'unknown');
          const dateLabel = entry?.date || `day ${index + 1}`;
          const uptime = entry?.uptimePercent === null || entry?.uptimePercent === undefined
            ? 'No uptime data'
            : `${Number(entry.uptimePercent).toFixed(2)}% uptime`;
          const downtime = entry?.downtimeMinutes === null || entry?.downtimeMinutes === undefined
            ? ''
            : `, ${Number(entry.downtimeMinutes || 0)} minutes downtime`;
          return (
            <span
              key={`${dateLabel}-${index}`}
              role="listitem"
              tabIndex={0}
              title={`${dateLabel}: ${meta.label}, ${uptime}${downtime}`}
              aria-label={`${dateLabel}: ${meta.label}, ${uptime}${downtime}`}
              className={[
                'inline-block shrink-0 rounded-[2px] focus:outline-none focus:ring-2 focus:ring-slate-900/30',
                compact ? 'h-5 w-[4px]' : 'h-6 w-[5px]',
                meta.bar,
              ].join(' ')}
            />
          );
        })}
      </div>
    </div>
  );
}
