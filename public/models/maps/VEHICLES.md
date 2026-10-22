# Vehicle models, sources and runtime use

Procedural City uses the following user-supplied GLBs unchanged. Author/source/license entries below come from each file's embedded metadata. Original attribution requirements apply; **do not infer a third-party license from a filename**, missing credit or the project's code license. Verify source terms and relevant rights before reuse.

## Car_Crashed

- File: `car_crashed.glb`
- Original title: Car_Crashed
- Author: busko (https://sketchfab.com/busko)
- Source: https://sketchfab.com/3d-models/car-crashed-d1070e1cc8a44ca9a9b164a80c1e314d
- Embedded license: CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

## Crashed Abandoned Car - Game Ready

- File: `crashed_abandoned_car_-_game_ready.glb`
- Original title: Crashed Abandoned Car - Game Ready
- Author: Rashad Ibrahimli (https://sketchfab.com/rashad-ibrahimli)
- Source: https://sketchfab.com/3d-models/crashed-abandoned-car-game-ready-66ef51a84c9843dda53bf0b4b9020011
- Embedded license: CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

## Damaged F1 car

- File: `damaged_f1_car.glb`
- Original title: Damaged F1 car
- Author: Rohit Paradkar (https://sketchfab.com/rohitparadkar)
- Source: https://sketchfab.com/3d-models/damaged-f1-car-bc1c7c1096d14693a93f511486a668f0
- Embedded license: CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

## Runtime presentation

[vehicles.js](../../engine/vehicles.js) defines scene-root selection and physical sizes for authoring/rendering. Wrecks keep scene-space proportions and opened/damaged bodywork while leaving navigation clear. The shipped eight-vehicle layout uses one crashed car, two abandoned cars and one F1 wreck, mixed with four street-kit trucks.

Meshes are merged by material and instanced rather than cloned into hundreds of scene nodes. Normalization/root selection does not rewrite source GLBs or grant rights to other unlisted street-kit assets. See [Procedural City](../../../docs/proc-city.md) for collision, layout and rendering limits.

中文：三份车辆模型的作者、来源及许可取自内嵌元数据；文件名或代码许可不代表模型授权。游戏仅运行时选取、归一化和批处理，原始文件不改写。
