# Free Music App — V1

Build an Android-first **free music discovery and streaming app** using:

- React Native
- Expo
- TypeScript
- Expo Router
- SQLite
- Zustand
- TanStack Query
- Zod

No backend in V1.

## Core Goal

Build a music app that helps users **find music wherever it is available across supported online music sources**.

The user should be able to search for:

- Songs
- Artists
- Albums
- Remixes
- Covers
- DJ mixes
- Independent/creator music
- Instrumentals
- Different versions of the same song

The app should combine results from multiple providers into a **single unified search experience**.

Use a provider-based architecture so new music sources can be added later without changing the app.

## Search & Discovery

Implement a powerful unified search system:

```text
User Search
     ↓
Search All Providers
     ↓
Normalize Results
     ↓
Remove Duplicates
     ↓
Rank Results
     ↓
Unified Results
```

Search should support:

- Exact matching
- Partial matching
- Artist + song
- Song + artist
- Album search
- Fuzzy matching
- Spelling variations
- Remixes/versions
- Creator names

Show useful sections such as:

- Best Match
- Songs
- Artists
- Albums
- Remixes
- Similar Results
- Other Sources

Allow the user to see **which source each result comes from**.

## Recommendations & Suggestions

Build a local recommendation engine.

Learn from:

- Search history
- Listening history
- Play count
- Skip count
- Favorites
- Playlists
- Recently played
- Artists frequently played
- Genres frequently played
- Similar songs
- Similar artists

Home screen should dynamically show:

- Recommended for You
- Because You Listened To...
- Similar to Your Favorites
- Continue Listening
- Recently Played
- Most Played
- Discover Something New
- Trending/Popular from available providers
- New discoveries

When the user searches for a song, also suggest:

```text
Similar Songs
Similar Artists
Remixes
Covers
More From This Artist
Related Music
```

Recommendations should work **without a backend** using locally stored user behavior.

## Local Library

Support:

- Favorites
- Playlists
- Recently played
- Search history
- Listening history
- Queue
- Play statistics

Store metadata and references locally, not large audio files.

## Player

Implement:

- Play/pause
- Seek
- Next/previous
- Queue
- Shuffle
- Repeat
- Background playback
- Android media controls
- Notification controls
- Mini player
- Full Now Playing screen
- Album artwork

## Architecture

```text
src/
├── app/
├── components/
├── features/
│   ├── home/
│   ├── search/
│   ├── player/
│   ├── library/
│   ├── playlists/
│   ├── history/
│   └── recommendations/
├── services/
│   ├── providers/
│   ├── player/
│   ├── database/
│   ├── search/
│   ├── recommendations/
│   └── cache/
├── store/
├── hooks/
├── types/
├── utils/
└── theme/
```

Create common models such as:

```text
Track
Artist
Album
Playlist
SearchResult
MusicProvider
Recommendation
```

Every provider should implement a common interface:

```text
search()
getTrack()
getArtist()
getAlbum()
getRecommendations()
```

This allows additional music sources to be plugged in later.

## Performance

Optimize for large music libraries and low-memory Android devices:

- Pagination
- Lazy loading
- Database indexes
- Image caching
- Network caching
- Limited in-memory history
- Duplicate detection
- Efficient search
- Background tasks where appropriate
- Automatic cache cleanup
- Avoid unnecessary React renders

## UI

Create a modern dark music-player UI with:

- Home
- Search
- Library
- Playlists
- Now Playing
- Mini Player

Provide loading, empty, offline and error states.

## Development Phases

### Phase 1

Project setup, architecture, navigation, theme and database.

### Phase 2

Provider system + unified search + result normalization + deduplication.

### Phase 3

Library, favorites, playlists and history.

### Phase 4

Audio player, queue and background playback.

### Phase 5

Recommendations and personalized suggestions.

### Phase 6

Caching, performance, offline metadata and final Android optimization.

Start with **Phase 1 only**. Inspect the existing project first, make it compile successfully, then proceed phase by phase.
