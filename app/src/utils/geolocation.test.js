import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectLocationFromGps, reverseGeocodeCoordinates } from './geolocation';

const okJson = (payload) => ({ ok: true, json: async () => payload });

const geocodeResponse = {
    city: 'Bengaluru',
    principalSubdivision: 'Karnataka',
    postcode: '560001',
    countryName: 'India',
};

describe('reverseGeocodeCoordinates', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        localStorage.clear();
    });

    it('resolves via the primary provider and caches the result', async () => {
        const fetchMock = vi.fn().mockResolvedValue(okJson(geocodeResponse));
        vi.stubGlobal('fetch', fetchMock);

        const first = await reverseGeocodeCoordinates({ latitude: 12.9716, longitude: 77.5946 });
        expect(first).toMatchObject({
            city: 'Bengaluru',
            state: 'Karnataka',
            pincode: '560001',
            country: 'India',
            geocodeSource: 'bigdatacloud',
            isFromCache: false,
        });

        const second = await reverseGeocodeCoordinates({ latitude: 12.9716, longitude: 77.5946 });
        expect(second.isFromCache).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to nominatim when the primary provider fails', async () => {
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new Error('HTTP 503'))
            .mockResolvedValueOnce(okJson({ address: { city: 'Mumbai', state: 'Maharashtra', postcode: '400001', country: 'India' } }));
        vi.stubGlobal('fetch', fetchMock);

        const result = await reverseGeocodeCoordinates({ latitude: 19.076, longitude: 72.8777 });
        expect(result.city).toBe('Mumbai');
        expect(result.geocodeSource).toBe('nominatim');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('throws for non-finite coordinates', async () => {
        await expect(reverseGeocodeCoordinates({ latitude: NaN, longitude: 77 })).rejects.toThrow(
            'Invalid coordinates provided for reverse geocoding.',
        );
    });

    it('throws a mapping error when no provider yields a city or state', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({})));
        await expect(reverseGeocodeCoordinates({ latitude: 1.23, longitude: 4.56 })).rejects.toThrow(
            'Could not map GPS coordinates to a city/state.',
        );
    });
});

describe('detectLocationFromGps', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        delete navigator.geolocation;
        localStorage.clear();
    });

    it('combines GPS position and geocoding into a confident location fix', async () => {
        const getCurrentPosition = vi.fn((success) => success({
            coords: { latitude: 12.9716, longitude: 77.5946, accuracy: 15 },
        }));
        navigator.geolocation = { getCurrentPosition };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(geocodeResponse)));

        const result = await detectLocationFromGps();

        expect(result).toMatchObject({
            city: 'Bengaluru',
            state: 'Karnataka',
            pincode: '560001',
            country: 'India',
            latitude: 12.9716,
            longitude: 77.5946,
            accuracy: 15,
            positionSource: 'gps_precise',
            geocodeSource: 'bigdatacloud',
        });
        // accuracy 15m -> 95*0.62, full geocode score 100*0.38 => 97.
        expect(result.confidence).toBe(97);
        expect(getCurrentPosition.mock.calls[0][2]).toMatchObject({ enableHighAccuracy: true });
    });

    it('maps geolocation error codes to human-readable messages', async () => {
        navigator.geolocation = {
            getCurrentPosition: (_success, failure) => failure({ code: 1 }),
        };

        await expect(detectLocationFromGps()).rejects.toThrow(
            'Location permission denied. Allow location access and try again.',
        );
    });

    it('rejects with a support message when geolocation is unavailable', async () => {
        await expect(detectLocationFromGps()).rejects.toThrow('GPS is not supported in this browser.');
    });
});
