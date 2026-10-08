# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Full-length YouTube audio (self-hosted yt-dlp resolver)

YouTube currently serves third-party apps a ~70-second preview of most songs;
the app's built-in extractor detects this and keeps playing short videos, but
long tracks need a resolver. The app ships with a reference **yt-dlp resolver
server** (`server/`) that gets around YouTube's preview cap (via yt-dlp's EJS
/poToken support) and streams the whole file through the app's built-in
Settings → Stream resolver slot.

Run it on a PC or VPS, then enter its URL in **Settings → Stream resolver**:

```bash
cd server
python -m pip install -U --pre "yt-dlp[default]"   # bundles yt-dlp-ejs
python ytdlp_resolver.py --port 8080
```

Plain-`http://` resolvers work on Android (the app enables cleartext for
user-configured endpoints); use `https://` behind a reverse proxy when the
server is reachable beyond your own network. For zero-setup internet hosting,
`server/` includes a `Dockerfile` ready for a free Hugging Face Space (Docker
SDK, API key passed as a secret) — see *Deploy to Hugging Face Spaces* in
[`server/README.md`](server/README.md).

See [`server/README.md`](server/README.md) for full setup (Node/Deno
requirement, authentication, tunnel vs. direct mode, troubleshooting).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
