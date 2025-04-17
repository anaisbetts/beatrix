import { DateTime } from 'luxon'

/**
 * Formats a date in the "yyyy-mm-dd hh:mm:ss" format in the local timezone from AppConfig
 * This is the preferred format for communicating dates to LLMs as it's simple and human-readable
 *
 * @param date Date to format (defaults to now)
 * @param timezone IANA timezone string (e.g., "America/New_York")
 * @returns Formatted date string in the specified timezone
 */
export function formatDateForLLM(
  date: Date = new Date(),
  timezone: string
): string {
  // Format the date using Intl.DateTimeFormat for robust timezone handling
  // Use en-CA which is YYYY-MM-DD, then combine with time from en-US (HH:MM:SS)
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone,
  })
  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: timezone,
  })

  const datePart = dateFormatter.format(date)
  const timePart = timeFormatter.format(date)

  return `${datePart} ${timePart}`
}

/**
 * Parses a local date string (YYYY-MM-DD HH:MM:SS) provided by the LLM,
 * interpreting it relative to the specified timezone using Luxon.
 *
 * @param dateStr Date string in "YYYY-MM-DD HH:MM:SS" format
 * @param timezone IANA timezone string (e.g., "America/New_York")
 * @returns Date object representing the corresponding UTC instant
 */
export function parseDateFromLLM(dateStr: string, timezone: string): Date {
  const formatString = 'yyyy-MM-dd HH:mm:ss' // Luxon format string

  try {
    const dt = DateTime.fromFormat(dateStr, formatString, { zone: timezone })

    if (!dt.isValid) {
      // Log the reason if available
      console.error(
        `Luxon parsing error for "${dateStr}" in zone "${timezone}": ${dt.invalidReason} - ${dt.invalidExplanation}`
      )
      throw new Error(
        `Invalid date format or timezone: ${dt.invalidReason || 'Unknown error'}`
      )
    }

    // Convert the Luxon DateTime object to a standard JavaScript Date object (which is UTC)
    return dt.toJSDate()
  } catch (err: any) {
    console.error(
      `Error parsing date string "${dateStr}" with timezone "${timezone}" using Luxon:`,
      err
    )
    throw new Error(
      `Failed to parse date for timezone ${timezone}: ${err.message}`
    )
  }
}

/**
 * Converts a Date to a SQLite string format 'YYYY-MM-DD HH:MM:SS' in UTC.
 * Use this for database storage.
 *
 * @param date Date to format (defaults to now)
 * @returns SQLite UTC string format
 */
export function dateToSqliteString(date: Date = new Date()): string {
  const year = date.getUTCFullYear()
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0')
  const day = date.getUTCDate().toString().padStart(2, '0')
  const hours = date.getUTCHours().toString().padStart(2, '0')
  const minutes = date.getUTCMinutes().toString().padStart(2, '0')
  const seconds = date.getUTCSeconds().toString().padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

/**
 * Parse an ISO8601 string to a Date object
 *
 * @param isoString ISO8601 date string
 * @returns Date object
 */
export function parseISO8601(isoString: string): Date {
  return new Date(isoString)
}

/**
 * Converts a Date to an ISO8601 string, preserving timezone information
 * Use this for database storage and API communication
 *
 * @param date Date to format
 * @returns ISO8601 string with timezone information
 */
export function dateToISO8601(date: Date = new Date()): string {
  return date.toISOString()
}
