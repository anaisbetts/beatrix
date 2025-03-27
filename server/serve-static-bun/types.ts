import type { Errorlike } from "bun";

/**
 * Checks if an object is an error-like object, i.e. has a `code` property.
 *
 * @param error The error to check
 */
export function isErrorlike(error: unknown): error is Errorlike {
	if (typeof error !== "object" || error === null) {
		return false;
	}
	return Object.hasOwn(error, "code");
}
