import { statusMeta } from './statusMeta';
import { useIntl } from 'react-intl';

export default function UptimeBars({ history = [], compact = false, label = '' }) {
  const intl = useIntl();
  const bars = Array.isArray(history) ? history.slice(-90) : [];
  const resolvedLabel = label || intl.formatMessage({ id: 'status.uptime.history', defaultMessage: 'Uptime history' });

  return (
    <div className="min-w-0" aria-label={resolvedLabel}>
      <div className="flex items-end gap-1 overflow-x-auto pb-1" role="list" aria-label={resolvedLabel}>
        {bars.map((entry, index) => {
          const meta = statusMeta(entry?.status || 'unknown');
          const dateLabel = entry?.date || intl.formatMessage(
            { id: 'status.uptime.dayNumber', defaultMessage: 'day {value}' },
            { value: index + 1 },
          );
          const hasNoData = (entry?.status || 'unknown') === 'unknown'
            || entry?.uptimePercent === null
            || entry?.uptimePercent === undefined;
          const uptime = entry?.uptimePercent === null || entry?.uptimePercent === undefined
            ? intl.formatMessage({ id: 'status.uptime.noData', defaultMessage: 'No uptime data' })
            : intl.formatMessage(
              { id: 'status.uptime.percentLabel', defaultMessage: '{value}% uptime' },
              { value: Number(entry.uptimePercent).toFixed(2) },
            );
          const downtime = entry?.downtimeMinutes === null || entry?.downtimeMinutes === undefined
            ? ''
            : intl.formatMessage(
              { id: 'status.uptime.downtimeMinutes', defaultMessage: ', {value} minutes downtime' },
              { value: Number(entry.downtimeMinutes || 0) },
            );
          const accessibleLabel = hasNoData
            ? intl.formatMessage(
              { id: 'status.uptime.dayNoDataLabel', defaultMessage: '{dateLabel}: No monitoring data for this day' },
              { dateLabel },
            )
            : intl.formatMessage(
              { id: 'status.uptime.dayStatusLabel', defaultMessage: '{dateLabel}: {label}, {uptime}{downtime}' },
              { dateLabel, downtime, label: meta.label, uptime },
            );
          return (
            <span
              key={`${dateLabel}-${index}`}
              role="listitem"
              tabIndex={0}
              title={accessibleLabel}
              aria-label={accessibleLabel}
              className={[
                'inline-block shrink-0 focus:outline-none focus:ring-2',
                compact ? 'h-5 w-1' : 'h-6 w-1',
              ].join(' ')}
              style={{ backgroundColor: meta.barColor }}
            />
          );
        })}
      </div>
    </div>
  );
}
