import { describe, expect, it } from 'vitest';
import { getShipmentStage, ORDER_FLOW_STAGES, SHIPMENT_STATUS_RANK, STAGE_LABEL_FALLBACKS } from './orderProgress';

describe('orderProgress stage derivation', () => {
    it('keeps legacy processing orders on the confirmed stage', () => {
        expect(getShipmentStage({ orderStatus: 'processing' })).toBe('placed');
        expect(getShipmentStage({ orderStatus: 'placed' })).toBe('placed');
        expect(getShipmentStage({})).toBe('placed');
    });

    it('treats cancelled orders and timestamps as cancelled regardless of shipments', () => {
        expect(getShipmentStage({ orderStatus: 'cancelled' })).toBe('cancelled');
        expect(getShipmentStage({ orderStatus: 'shipped', cancelledAt: '2026-09-19T00:00:00Z' })).toBe('cancelled');
        expect(getShipmentStage({ orderStatus: 'processing', shipments: [{ status: 'shipped' }], cancelledAt: 'x' })).toBe('cancelled');
    });

    it('maps delivered orders and delivery checkpoints to the delivered stage', () => {
        expect(getShipmentStage({ orderStatus: 'delivered' })).toBe('delivered');
        expect(getShipmentStage({ orderStatus: 'shipped', isDelivered: true })).toBe('delivered');
        expect(getShipmentStage({ orderStatus: 'processing', shipments: [{ status: 'delivered' }] })).toBe('delivered');
    });

    it('lets shipment checkpoints outrank the legacy order status', () => {
        expect(getShipmentStage({ orderStatus: 'processing', shipments: [{ status: 'packed' }] })).toBe('packed');
        expect(getShipmentStage({ orderStatus: 'placed', shipments: [{ status: 'out_for_delivery' }] })).toBe('out_for_delivery');
        expect(getShipmentStage({ orderStatus: 'shipped', shipments: [{ status: 'pending' }] })).toBe('shipped');
    });

    it('ignores unknown shipment statuses and clamps the rank into the stage list', () => {
        expect(getShipmentStage({ orderStatus: 'placed', shipments: [{ status: 'exception' }, { status: 'returned' }] })).toBe('placed');
        expect(getShipmentStage({ orderStatus: 'processing', shipments: [{ status: 42 }] })).toBe('placed');
        expect(ORDER_FLOW_STAGES).toHaveLength(5);
        expect(Object.keys(SHIPMENT_STATUS_RANK)).toHaveLength(5);
    });

    it('provides an English fallback label for every flow stage plus cancelled', () => {
        for (const stage of [...ORDER_FLOW_STAGES, 'cancelled']) {
            expect(STAGE_LABEL_FALLBACKS[stage]).toBeTruthy();
        }
    });
});
