import { DateTime } from 'luxon'

import { w } from '../logging'

/**
 * Formats a Luxon DateTime object into the "yyyy-mm-dd hh:mm:ss" format.
 * This is the preferred format for communicating dates to LLMs.
 * The function respects the timezone set within the input DateTime object.
 *
 * @param dt Luxon DateTime object (should already be in the desired timezone)
 * @returns Formatted date string (e.g., "2024-03-15 18:30:00")
 */
export function formatDateForLLM(dt: DateTime): string {
  return dt.toFormat('yyyy-MM-dd HH:mm:ss')
}

/**
 * Parses a local date string (YYYY-MM-DD HH:MM:SS) provided by the LLM,
 * interpreting it relative to the specified timezone using Luxon.
 *
 * @param dateStr Date string in "YYYY-MM-DD HH:MM:SS" format
 * @param timezone IANA timezone string (e.g., "America/New_York")
 * @returns Date object representing the corresponding UTC instant
 */
export function parseDateFromLLM(dateStr: string, timezone: string): DateTime {
  const formatString = 'yyyy-MM-dd HH:mm:ss' // Luxon format string

  try {
    const dt = DateTime.fromFormat(dateStr, formatString, { zone: timezone })

    if (!dt.isValid) {
      // Log the reason if available
      w(
        `Luxon parsing error for "${dateStr}" in zone "${timezone}": ${dt.invalidReason} - ${dt.invalidExplanation}`
      )
      throw new Error(
        `Invalid date format or timezone: ${dt.invalidReason || 'Unknown error'}`
      )
    }

    // Convert the Luxon DateTime object to a standard JavaScript Date object (which is UTC)
    return dt
  } catch (err: any) {
    w(
      `Error parsing date string "${dateStr}" with timezone "${timezone}" using Luxon:`,
      err
    )
    throw new Error(
      `Failed to parse date for timezone ${timezone}: ${err.message}`
    )
  }
}
