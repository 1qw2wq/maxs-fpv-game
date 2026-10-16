// Shared static authoring/render manifest. Physical size includes opened/crashed
// bodywork, not just the cabin: visuals and the shared cover AABB use one size.
// New uploads keep their scene-space proportions and have their long axis at Z.
const KIT = '/models/maps/GLB format/';
export const CITY_VEHICLES = {
  parked_truck: { file:KIT+'truck-grey.glb', node:'truck-grey', size:[2,1.9,4.5] },
  truck_green: { file:KIT+'truck-green.glb', node:'truck-green', size:[2,1.9,4.5] },
  truck_flat: { file:KIT+'truck-flat.glb', node:'truck-flat', size:[2,1.45,4.5] },
  truck_cargo: { file:KIT+'truck-green-cargo.glb', node:'truck-green-cargo', size:[2,2.3,4.5] },
  car_crashed: { file:'/models/maps/car_crashed.glb', node:'Sketchfab_model', size:[2.3234,1.9282,4.5] },
  car_abandoned: { file:'/models/maps/crashed_abandoned_car_-_game_ready.glb', node:'Sketchfab_model', size:[2.9926,1.8642,4.35] },
  car_f1: { file:'/models/maps/damaged_f1_car.glb', node:'Sketchfab_model', size:[1.7857,.9099,4.5] },
};

export function cityVehicle(index) {
  // Detailed uploaded models are landmarks, not dozens of 150k-triangle copies.
  // Keep the economical abandoned car common and vary the original trucks too.
  if (index === 2) return 'car_f1';
  if (index === 5 || index === 19) return 'car_crashed';
  return ['parked_truck','car_abandoned','truck_green','truck_flat','car_abandoned','truck_cargo'][index % 6];
}
