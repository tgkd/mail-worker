import { Hono } from 'hono/quick';
import { sha256 } from 'hono/utils/crypto';
import { bearerAuth } from 'hono/bearer-auth';
import { HTTPException } from 'hono/http-exception';
import { Buffer } from 'node:buffer';

interface EmailRequest {
  from: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: Array<
    | {
        content: ArrayBuffer | string;
        filename: string;
      }
    | {
        path: string;
        filename: string;
      }
  >;
}

interface RequestData {
  receiver: string;
  payload: string[];
  emailSubject?: string;
  emailBody?: string;
}

type Env = {
  API_HOST: string;
  EMAIL_API_KEY: string;
  SENDER_EMAIL: string;
  IMG_BUCKET: R2Bucket;
  AUTH_KEY: string;
  DEFAULT_EMAIL_BODY_HTML: string;
};

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (ctx, next) => {
  const auth = bearerAuth({ token: ctx.env.AUTH_KEY });
  await auth(ctx, next);
});

app.put('/upload', async (c) => {
  const data = await c.req.json<RequestData>();
  const { payload, receiver, emailBody, emailSubject } = data;

  if (!receiver || !Array.isArray(payload) || payload.length === 0) {
    throw new HTTPException(400, { message: 'Invalid request' });
  }

  let attachments: EmailRequest['attachments'] = [];

  for await (const i of payload) {
    const body = Uint8Array.from(atob(i.replace(/^data[^,]+,/, '')), (c) =>
      c.charCodeAt(0)
    );
    const key = (await sha256(body)) + '.' + 'png';

    await c.env.IMG_BUCKET.put(key, body, {
      httpMetadata: { contentType: 'image/png' },
    });

    attachments.push({
      content: Buffer.from(body),
      filename: key,
    });
  }

  if (!attachments.length) {
    throw new HTTPException(400, {
      message: 'Invalid request. No attachments found',
    });
  }

  const emailData: EmailRequest = {
    from: c.env.SENDER_EMAIL,
    to: receiver,
    subject: emailSubject || 'Noreply',
    html: emailBody || c.env.DEFAULT_EMAIL_BODY_HTML,
    attachments,
  };

  const eRes = await fetch(c.env.API_HOST, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${c.env.EMAIL_API_KEY}`,
    },
    body: JSON.stringify(emailData),
  });

  const res = await gatherResponse(eRes);

  return c.text(res);
});

async function gatherResponse(response: Response) {
  const { headers } = response;
  const contentType = headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return JSON.stringify(await response.json());
  }
  return response.text();
}

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }

  return c.notFound();
});

/*

const maxAge = 60 * 60 * 24 * 30;

app.get(
  '*',
  cache({
    cacheName: 'frosty-king-4811',
  })
);

app.get('/:key', async (c) => {
  const key = c.req.param('key');

  const object = await c.env.IMG_BUCKET.get(key);
  if (!object) return c.notFound();
  const data = await object.arrayBuffer();
  const contentType = object.httpMetadata?.contentType ?? '';

  return c.body(data, 200, {
    'Cache-Control': `public, max-age=${maxAge}`,
    'Content-Type': contentType,
  });
});
 */
export default app;
