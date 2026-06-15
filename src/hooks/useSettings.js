import { useCallback, useState } from 'react'
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../constants'
import { loadFromStorage, saveToStorage } from '../utils/storage'
import { parseKeywordList } from '../utils/fetchJobs'
import { syncSettingsToServer } from '../utils/serverSync'

export function useSettings() {
  const [settings, setSettings] = useState(() => {
    const stored = loadFromStorage(STORAGE_KEYS.settings, {})
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      fetchCompanySize:
        'fetchCompanySize' in stored
          ? stored.fetchCompanySize !== false
          : DEFAULT_SETTINGS.fetchCompanySize,
    }
  })

  const saveSettings = useCallback((nextSettings) => {
    setSettings(nextSettings)
    saveToStorage(STORAGE_KEYS.settings, nextSettings)
    syncSettingsToServer(nextSettings)
  }, [])

  const isConfigured = parseKeywordList(settings.keywords).length > 0

  return { settings, saveSettings, isConfigured }
}
