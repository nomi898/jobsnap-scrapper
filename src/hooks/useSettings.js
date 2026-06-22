import { parseKeywordList } from '../utils/fetchJobs'
import { useSettingsContext } from '../context/SettingsContext'

export function useSettings() {
  const { settings, saveSettings } = useSettingsContext()
  const isConfigured = parseKeywordList(settings.keywords).length > 0

  return { settings, saveSettings, isConfigured }
}
