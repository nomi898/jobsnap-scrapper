import { REGION_OPTIONS, resolveGeoId } from '../constants'

export function isPresetRegion(geoId) {
  return REGION_OPTIONS.some(
    (region) => region.geoId === geoId && region.geoId !== 'custom'
  )
}

export function getFormRegionValues(settings) {
  const savedGeoId = settings.regionGeoId || '92000000'

  if (savedGeoId === 'custom' || !isPresetRegion(savedGeoId)) {
    return {
      regionGeoId: 'custom',
      customGeoId: settings.customGeoId || savedGeoId,
    }
  }

  return {
    regionGeoId: savedGeoId,
    customGeoId: settings.customGeoId || '',
  }
}

export function buildRegionPayload(settings) {
  return { geoId: resolveGeoId(settings) }
}
