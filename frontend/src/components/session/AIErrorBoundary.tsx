'use client'
import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  hasError: boolean
  error: string
}

export class AIErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: '' }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message }
  }

  componentDidCatch(error: Error) {
    console.error('[AI Feature Error]', error)
  }

  render() {
    if (this.state.hasError) {
      console.warn('[AI] Feature failed, continuing without it:', this.state.error)
      return null
    }
    return this.props.children
  }
}
