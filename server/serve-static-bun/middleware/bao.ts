import type { Context } from "baojs/dist/context";

export default function getBaoMiddleware(
	getResponse: (req: Request) => Promise<Response>,
	handleErrors: boolean,
) {
	return async (ctx: Context) => {
		const res = await getResponse(ctx.req);
		switch (res.status) {
			case 403:
			case 404:
				return handleErrors ? ctx.sendRaw(res).forceSend() : ctx;

			default:
				return ctx.sendRaw(res).forceSend();
		}
	};
}
