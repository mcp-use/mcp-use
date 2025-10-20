import type { SavedRequest } from '@/client/components/tools'
import { useEffect, useState } from 'react'

const SAVED_REQUESTS_KEY = 'mcp-inspector-saved-requests'

export function useSavedRequests() {
  const [savedRequests, setSavedRequests] = useState<SavedRequest[]>([])

  // Load saved requests from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVED_REQUESTS_KEY)
      if (saved) {
        setSavedRequests(JSON.parse(saved))
      }
    }
    catch (error) {
      console.error('[useSavedRequests] Failed to load saved requests:', error)
    }
  }, [])

  // Listen for changes to saved requests from other components
  useEffect(() => {
    const handleStorageChange = (e: any) => {
      if (e.key === SAVED_REQUESTS_KEY && e.newValue) {
        try {
          setSavedRequests(JSON.parse(e.newValue))
        }
        catch (error) {
          console.error('[useSavedRequests] Failed to parse saved requests:', error)
        }
      }
    }

    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [])

  return savedRequests
}
