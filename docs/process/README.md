# Process record

Review artifacts kept from the build, in order. Each one changed the film.

1. **First contact sheet** (`01`): the whole film, one still per second, before any full render. It showed the structure worked and that the 1984 bitmap letter and the finale's missing last slot did not.
2. **Point-to-point morphing tears** (`02`): mid-transition frames rendered with `reel sheet --at`. Between the grotesque and geometric *a* the counter cuts through the stem; into pixels the letter shatters; year digits break apart.
3. **Distance-field morphing** (`03`): the same moments after switching to signed distance fields and marching squares, with digits that roll when their value changes.
4. **Square layout collision** (`04`) and **fix** (`05`): the 1:1 version is checked separately; the readouts collided with the note line until the vertical rhythm was reflowed.
5. **Score spectrogram** (`06`): the score cannot be listened to in the build environment, so it was checked objectively: a log-frequency spectrogram per era, per-section RMS loudness, and the mastered integrated loudness and true peak.
6. **New soundtrack**: the first score was synthesized in code. It was replaced by a Google Flow Music track at the film's tempo, edited on bar lines, with the code-generated sound effects kept underneath. The spectrogram in `06` belongs to the first score.
