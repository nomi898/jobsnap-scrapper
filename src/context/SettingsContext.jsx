import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../constants'
import { loadFromStorage, saveToStorage } from '../utils/storage'

const SettingsContext = createContext(null)

function mergeStoredSettings(stored) {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    fetchCompanySize:
      'fetchCompanySize' in stored
        ? stored.fetchCompanySize !== false
        : DEFAULT_SETTINGS.fetchCompanySize,
  }
}

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(() =>
    mergeStoredSettings(loadFromStorage(STORAGE_KEYS.settings, {}))
  )

  const saveSettings = useCallback((nextSettings) => {
    const merged = mergeStoredSettings(nextSettings)
    setSettings(merged)
    saveToStorage(STORAGE_KEYS.settings, merged)
  }, [])

  const value = useMemo(
    () => ({ settings, saveSettings }),
    [settings, saveSettings]
  )

  return (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  )
}

export function useSettingsContext() {
  const context = useContext(SettingsContext)
  if (!context) {
    throw new Error('useSettings must be used within SettingsProvider')
  }
  return context
}
