# Uploaded vehicle models

The following user-supplied binaries are used unchanged in Procedural City:

- `car_crashed.glb`
- `crashed_abandoned_car_-_game_ready.glb`
- `damaged_f1_car.glb`

Original upload/source licenses and attribution requirements still apply. No
third-party license is inferred from a filename.

`public/engine/vehicles.js` defines the scene-root selection and physical sizes
used by both map authoring and rendering. Parked cover includes opened/damaged
bodywork, keeps scene-space proportions, and leaves the navigation graph clear.
The heavier models are limited to two crashed cars and one F1 wreck per city;
the smaller abandoned car is mixed with the existing truck kit. Mesh parts are
merged by material and instanced, not cloned as hundreds of scene nodes.
