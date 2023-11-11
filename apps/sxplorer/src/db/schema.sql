-- table: Music Playback
-- stores: List of songs played by the user on Spotify
CREATE TABLE music_playback (
    id TEXT PRIMARY KEY, -- Unique identifier for the record
    batchId TEXT, -- Indicates which batch this record belongs to
    endTime DATETIME, -- Indicates when the song ended
    artistName TEXT, -- Indicates the artist name
    trackName TEXT, -- Indicates the track name
    msPlayed INTEGER -- Indicates how many milliseconds the song was played
);

CREATE TABLE files (
    id TEXT PRIMARY KEY,
    batchId TEXT,
    fileType TEXT,
    records INTEGER 
);

SELECT crsql_as_crr('music_playback');
SELECT crsql_as_crr('files');
-- SELECT crsql_fract_as_ordered('test', 'position');

-- CREATE TABLE IF NOT EXISTS local_notes (id PRIMARY KEY, content TEXT);