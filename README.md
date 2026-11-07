# law_task

A one-page test of LINE Login through LIFF. It shows the user's name, LINE userId and ID token.

## Setup

1. In the [LINE Developers Console](https://developers.line.biz/console/), open your LINE Login channel, go to the **LIFF** tab and add a LIFF app:
   - **Endpoint URL**: the HTTPS URL where `index.html` is hosted, e.g. `https://pharase.github.io/law_task/`
   - **Scopes**: `openid`, `profile`
2. Copy the LIFF ID into `LIFF_ID` in `index.html`.
3. Host the page over HTTPS at that exact Endpoint URL (GitHub Pages works). Then open it in a browser, or open `https://liff.line.me/<LIFF_ID>` inside LINE.

## Troubleshooting

- **400 Bad Request on login**: the page URL doesn't match the LIFF **Endpoint URL**. Open it from the registered URL, not `file://` or `localhost`.
- **Channel status "Developing"**: only the channel's admins and testers can log in. Add your account under **Roles**, or publish the channel.
- **ID token is empty**: turn on the `openid` scope.

The ID token shown here is for display only. Your backend must verify the raw token with LINE's [verify endpoint](https://developers.line.biz/en/reference/line-login/#verify-id-token) before trusting it.
