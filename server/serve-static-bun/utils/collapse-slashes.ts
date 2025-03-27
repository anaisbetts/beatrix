interface CollapseSlashesOptions {
	/**
	 * Keep leading slashes.
	 *
	 * @default true
	 */
	keepLeading?: boolean;

	/**
	 * Keep trailing slashes.
	 *
	 * @default true
	 */
	keepTrailing?: boolean;
}

/**
 * By default, collapses all leading, trailing and duplicate slashes into one.
 * Can also remove leading and trailing slashes entirely.
 *
 * @param options
 * @returns New string with slashes normalized
 */
export function collapseSlashes(str: string, options: CollapseSlashesOptions = {}) {
	const { keepLeading = true, keepTrailing = true } = options;

	str = `/${str}/`.replaceAll(/[/]+/g, "/");

	if (!keepLeading) {
		str = str.substring(1);
	}

	if (!keepTrailing) {
		str = str.substring(0, str.length - 1);
	}

	return str;
}
