/**
 * Pagination utilities for inline keyboard buttons.
 * Reusable pagination logic for session lists, model lists, and other paginated displays.
 */

import type { InlineKeyboardButton } from './types'

export interface PaginationOptions<T> {
  items: T[]
  page: number
  pageSize: number
  callbackPrefix: string
  buttonLabel: (item: T) => string
  buttonData: (item: T) => string
}

export interface PaginatedResult {
  buttons: InlineKeyboardButton[][]
  page: number
  totalPages: number
}

/**
 * Create paginated inline keyboard buttons from a list of items.
 * Returns button rows for the current page, including navigation buttons if needed.
 */
export function createPaginatedButtons<T>(options: PaginationOptions<T>): PaginatedResult {
  const { items, page, pageSize, callbackPrefix, buttonLabel, buttonData } = options

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const clampedPage = Math.max(0, Math.min(page, totalPages - 1))

  const start = clampedPage * pageSize
  const end = start + pageSize
  const pageItems = items.slice(start, end)

  const buttons: InlineKeyboardButton[][] = pageItems.map((item) => [
    {
      text: buttonLabel(item),
      callback_data: buttonData(item),
    },
  ])

  // Add navigation row if there are multiple pages
  if (totalPages > 1) {
    const navRow: InlineKeyboardButton[] = []

    // Previous button (only if not on first page)
    if (clampedPage > 0) {
      navRow.push({
        text: '←',
        callback_data: `${callbackPrefix}:page:${clampedPage - 1}`,
      })
    }

    // Page indicator
    navRow.push({
      text: `${clampedPage + 1}/${totalPages}`,
      callback_data: `${callbackPrefix}:noop`,
    })

    // Next button (only if not on last page)
    if (clampedPage < totalPages - 1) {
      navRow.push({
        text: '→',
        callback_data: `${callbackPrefix}:page:${clampedPage + 1}`,
      })
    }

    buttons.push(navRow)
  }

  return {
    buttons,
    page: clampedPage,
    totalPages,
  }
}
