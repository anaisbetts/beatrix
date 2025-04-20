import Editor from '@monaco-editor/react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Subject, firstValueFrom } from 'rxjs'
import { debounceTime, switchMap } from 'rxjs/operators'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { useWebSocket } from '../components/ws-provider'

// Import WebSocket hook

// Helper to get language from file path
const getLanguageFromPath = (filePath: string | null): string => {
  if (!filePath) return 'plaintext'
  const extension = filePath.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'js':
    case 'jsx':
      return 'javascript'
    case 'json':
      return 'json'
    case 'md':
      return 'markdown'
    case 'py':
      return 'python'
    case 'yaml':
    case 'yml':
      return 'yaml'
    case 'html':
      return 'html'
    case 'css':
      return 'css'
    case 'toml':
      return 'toml'
    // Add more mappings as needed
    default:
      return 'plaintext'
  }
}

export function NotebookEditorPage() {
  const { api } = useWebSocket() // Get API from WebSocket context
  const [fileList, setFileList] = useState<string[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [language, setLanguage] = useState<string>('plaintext') // Add language state
  const [fileContent, setFileContent] = useState<string | undefined>(undefined)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [isSaving, setIsSaving] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [isCreateFileDialogOpen, setIsCreateFileDialogOpen] =
    useState<boolean>(false)
  const [createFileType, setCreateFileType] = useState<
    'cue' | 'automation' | null
  >(null)
  const [newFileName, setNewFileName] = useState<string>('')
  const saveSubjectRef = useRef(
    new Subject<{ file: string; content: string }>()
  )
  const editorContentRef = useRef<string | undefined>(undefined)

  // Fetch file list on component mount
  useEffect(() => {
    if (!api) return
    const sub = api.listNotebookFiles().subscribe({
      next: (files) => setFileList(files.sort()),
      error: (err) => setError(`Failed to list files: ${err.message}`),
    })
    return () => sub.unsubscribe()
  }, [api])

  // Fetch file content when a file is selected
  const handleFileSelect = useCallback(
    async (filePath: string) => {
      if (!api) return
      setSelectedFile(filePath)
      setLanguage(getLanguageFromPath(filePath)) // Set language on selection
      setFileContent(undefined) // Clear old content
      setIsLoading(true)
      setError(null)
      try {
        const content = await firstValueFrom(api.readNotebookFile(filePath))
        setFileContent(content)
        editorContentRef.current = content
      } catch (err: any) {
        setError(`Failed to read file ${filePath}: ${err.message}`)
        setFileContent('# Error loading file')
        editorContentRef.current = '# Error loading file'
      } finally {
        setIsLoading(false)
      }
    },
    [api]
  )

  // Handle editor content changes
  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      editorContentRef.current = value
      setFileContent(value)
      if (selectedFile && value !== undefined) {
        saveSubjectRef.current.next({ file: selectedFile, content: value })
      }
    },
    [selectedFile]
  )

  // Function to handle opening the create file dialog
  const handleCreateNewFile = useCallback(
    async (type: 'cue' | 'automation') => {
      setCreateFileType(type)
      setNewFileName(type === 'cue' ? 'new-cue.md' : 'new-automation.md') // Set default name
      setError(null) // Clear previous errors
      setIsCreateFileDialogOpen(true)
    },
    []
  )

  // Function to handle the actual creation via the dialog
  const submitCreateFile = useCallback(async () => {
    if (!api || !createFileType || !newFileName) return

    const fileName = newFileName.trim()

    // Basic client-side check (server does thorough validation)
    if (!fileName || fileName.includes('/') || fileName.includes('\\')) {
      setError('Invalid file name (cannot be empty or contain slashes).')
      return // Keep dialog open
    }

    setIsLoading(true) // Use isLoading state for feedback
    setError(null)
    try {
      const result = await firstValueFrom(
        api.createNotebookFile(fileName, createFileType)
      )
      setIsCreateFileDialogOpen(false) // Close dialog on success
      setNewFileName('') // Reset input
      // Refresh file list
      const files = await firstValueFrom(api.listNotebookFiles())
      setFileList(files.sort())
      // Select the new file
      await handleFileSelect(result.relativePath)
    } catch (err: any) {
      setError(`Failed to create ${createFileType}: ${err.message}`)
      // Keep dialog open on error
    } finally {
      setIsLoading(false)
    }
  }, [api, createFileType, newFileName, handleFileSelect])

  // Effect for debounced saving using RxJS
  useEffect(() => {
    if (!api) return

    const subscription = saveSubjectRef.current
      .pipe(
        debounceTime(1000), // Wait for 1 second of inactivity
        switchMap(({ file, content }) => {
          setIsSaving(true)
          setError(null)
          return api.writeNotebookFile(file, content)
        })
      )
      .subscribe({
        next: () => {
          setIsSaving(false)
        },
        error: (err) => {
          setError(`Failed to save file: ${err.message}`)
          setIsSaving(false)
        },
      })

    return () => subscription.unsubscribe()
  }, [api])

  // Effect to update editor content ref when fileContent changes externally (e.g., on load)
  useEffect(() => {
    editorContentRef.current = fileContent
  }, [fileContent])

  return (
    <div className="flex h-screen flex-col">
      <div className="border-border border-b p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Notebook Editor</h1>
          {isSaving && (
            <span className="text-sm text-muted-foreground">Saving...</span>
          )}
        </div>
      </div>
      {error && (
        <div className="bg-destructive text-destructive-foreground p-2">
          {error}
        </div>
      )}
      <div className="flex flex-grow space-x-0 overflow-hidden">
        {/* File Tree */}
        <div className="w-1/4 overflow-y-auto border-r p-2">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Files</h2>
            <div className="flex space-x-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleCreateNewFile('cue')}
              >
                + Cue
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleCreateNewFile('automation')}
              >
                + Auto
              </Button>
            </div>
          </div>
          {fileList.length === 0 && !error && !isLoading && (
            <div>Loading files...</div>
          )}
          {isLoading && fileList.length === 0 && <div>Loading...</div>}{' '}
          {/* Show loading only when list is empty initially */}
          <ul>
            {fileList.map((file) => (
              <li key={file} className="mb-1">
                <button
                  onClick={() => handleFileSelect(file)}
                  className={`w-full rounded px-2 py-1 text-left text-sm ${
                    selectedFile === file
                      ? 'bg-muted font-medium'
                      : 'hover:bg-muted/50'
                  }`}
                >
                  {file}
                </button>
              </li>
            ))}
          </ul>
        </div>
        {/* Editor */}
        <div className="w-3/4 flex-grow">
          <Editor
            height="100%"
            language={language} // Use dynamic language
            theme="vs-dark" // Or another theme
            value={editorContentRef.current ?? fileContent}
            onChange={handleEditorChange}
            loading={isLoading ? 'Loading...' : undefined}
            options={{
              readOnly: !selectedFile || isLoading || isSaving, // Read-only if no file, loading or saving
              minimap: { enabled: false },
              automaticLayout: true,
            }}
          />
        </div>
      </div>

      {/* Create File Dialog */}
      <AlertDialog
        open={isCreateFileDialogOpen}
        onOpenChange={setIsCreateFileDialogOpen}
      >
        <AlertDialogContent className="bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Create New {createFileType === 'cue' ? 'Cue' : 'Automation'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Enter a filename. It will be created in the `notebook/
              {createFileType}s/` directory.
              {error && (
                <p className="text-destructive mt-2">Error: {error}</p>
              )}{' '}
              {/* Show error inside dialog */}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2 py-4 bg-white">
            <Label htmlFor="name">Filename</Label>
            <Input
              id="name"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              placeholder={
                createFileType === 'cue' ? 'new-cue.md' : 'new-automation.md'
              }
              onKeyDown={async (e) => {
                if (e.key === 'Enter') await submitCreateFile()
              }} // Submit on Enter
              disabled={isLoading}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isLoading}
              onClick={() => setNewFileName('')}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={submitCreateFile}
              disabled={isLoading || !newFileName.trim()}
            >
              {isLoading ? 'Creating...' : 'Create'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default NotebookEditorPage
