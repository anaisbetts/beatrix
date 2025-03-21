'use client'

import { useState, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Send } from 'lucide-react'
import { useCommand } from '@anaisbetts/commands'

// Base URL for API requests
const API_BASE_URL = '/api'

export default function Chat() {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const [sendPrompt, result, reset] = useCommand(async () => {
    const response = await fetch(`${API_BASE_URL}/prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: input }),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to send prompt')
    }

    if (data.error) {
      throw new Error(data.error)
    }

    return data.text
  }, [input])

  const resetChat = useCallback(() => {
    reset()
    setInput('')
  }, [reset, setInput])

  const messages = result.mapOrElse({
    ok: (val) => <div>{val}</div>,
    err: (e) => <div className="text-gray-400 italic">It didn't. {e}</div>,
    pending: () => null,
  })

  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex items-center justify-between border-b p-4">
        <h2 className="text-lg font-semibold">Chat Session</h2>
        <Button variant="outline" size="sm" onClick={resetChat}>
          New Chat
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-border border-t p-4">
        <form onSubmit={sendPrompt} className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            className="flex-1"
            disabled={result.isPending()}
          />

          <Button type="submit" disabled={result.isPending() || !input.trim()}>
            <Send size={18} />
            <span className="sr-only">Send message</span>
          </Button>
        </form>
      </div>
    </div>
  )
}
