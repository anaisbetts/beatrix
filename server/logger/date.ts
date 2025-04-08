// const format = n => n > 9 ? n : `0${n}`;
const format = (n: number) => n.toString().padStart(2, '0')

/**
 * Dater extends Date to provide more formating methods.
 */
export default class Dater extends Date {
  /**
   * Get date string as yyyy-mm-dd hh:mm:ss
   * @param separator
   * @returns
   */
  override toLocaleString(separator = '-'): string {
    const dateString = this.toLocaleDateString(separator)
    const timeString = this.toLocaleTimeString()
    return `${dateString} ${timeString}`
  }

  /**
   * Get date string as yyyy-mm-dd
   * @param separator
   * @returns
   */
  override toLocaleDateString(separator = '-'): string {
    const year = format(this.getFullYear())
    const month = format(this.getMonth() + 1)
    const day = format(this.getDate())
    return `${year}${separator}${month}${separator}${day}`
  }

  /**
   * Get time string as hh:mm:ss
   * @returns
   */
  override toLocaleTimeString(): string {
    const hour = format(this.getHours())
    const minute = format(this.getMinutes())
    const second = format(this.getSeconds())
    return `${hour}:${minute}:${second}`
  }
}
