import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Save } from 'lucide-react'

interface SaveRequestDialogProps {
  isOpen: boolean
  requestName: string
  defaultPlaceholder: string
  onRequestNameChange: (name: string) => void
  onSave: () => void
  onCancel: () => void
}

export function SaveRequestDialog({
  isOpen,
  requestName,
  defaultPlaceholder,
  onRequestNameChange,
  onSave,
  onCancel,
}: SaveRequestDialogProps) {
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onCancel}
    >
      <div
        className="bg-white dark:bg-zinc-800 rounded-lg p-6 w-[400px] shadow-xl border border-gray-200 dark:border-zinc-700"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
          Save Request
        </h3>
        <div className="space-y-4">
          <div>
            <Label htmlFor="request-name">Request Name (optional)</Label>
            <Input
              id="request-name"
              value={requestName}
              onChange={(e) => onRequestNameChange(e.target.value)}
              placeholder={defaultPlaceholder}
              className="mt-2"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onSave()
                }
              }}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={onSave}>
              <Save className="h-4 w-4 mr-2" />
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
