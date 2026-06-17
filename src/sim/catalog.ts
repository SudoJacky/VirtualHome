import type { Catalog } from '../shared/types';

const catalog: Catalog = {
  rooms: [
    { id: 'entrance', name: 'Entrance', type: 'entry', connectedRooms: ['living_room'] },
    { id: 'living_room', name: 'Living Room', type: 'living', connectedRooms: ['entrance', 'dining_room', 'study'] },
    { id: 'kitchen', name: 'Kitchen', type: 'utility', connectedRooms: ['dining_room', 'bathroom'] },
    { id: 'dining_room', name: 'Dining Room', type: 'living', connectedRooms: ['living_room', 'kitchen'] },
    { id: 'master_bedroom', name: 'Master Bedroom', type: 'bedroom', connectedRooms: ['living_room', 'bathroom'] },
    { id: 'child_bedroom', name: 'Child Bedroom', type: 'bedroom', connectedRooms: ['living_room'] },
    { id: 'study', name: 'Study', type: 'work', connectedRooms: ['living_room'] },
    { id: 'bathroom', name: 'Bathroom', type: 'utility', connectedRooms: ['master_bedroom', 'kitchen'] },
    { id: 'garden', name: 'Garden', type: 'outdoor', connectedRooms: ['entrance', 'living_room'] }
  ],
  people: [
    { id: 'adult_1', kind: 'human', role: 'commuter adult', homeMember: true },
    { id: 'adult_2', kind: 'human', role: 'hybrid work adult', homeMember: true },
    { id: 'child_1', kind: 'human', role: 'student', homeMember: true },
    { id: 'senior_1', kind: 'human', role: 'senior family member', homeMember: true },
    { id: 'pet_1', kind: 'pet', role: 'house pet', homeMember: true }
  ],
  devices: [
    { id: 'door_lock_01', roomId: 'entrance', type: 'door_lock', name: 'Front Door Lock', metrics: ['locked'] },
    { id: 'entrance_motion_01', roomId: 'entrance', type: 'motion_sensor', name: 'Entrance Motion', metrics: ['motion', 'confidence'] },
    { id: 'living_light_01', roomId: 'living_room', type: 'light', name: 'Living Room Light', metrics: ['power', 'brightness'] },
    { id: 'tv_01', roomId: 'living_room', type: 'tv', name: 'Living Room TV', metrics: ['power', 'volume'] },
    { id: 'living_motion_01', roomId: 'living_room', type: 'motion_sensor', name: 'Living Motion', metrics: ['motion', 'confidence'] },
    { id: 'kitchen_light_01', roomId: 'kitchen', type: 'light', name: 'Kitchen Light', metrics: ['power', 'brightness'] },
    { id: 'kitchen_temp_01', roomId: 'kitchen', type: 'temperature_humidity_sensor', name: 'Kitchen Climate', metrics: ['temperature_c', 'humidity_percent'] },
    { id: 'fridge_01', roomId: 'kitchen', type: 'fridge', name: 'Fridge', metrics: ['door_open', 'power_w'] },
    { id: 'stove_01', roomId: 'kitchen', type: 'stove', name: 'Induction Stove', metrics: ['power_w', 'level'] },
    { id: 'range_hood_01', roomId: 'kitchen', type: 'range_hood', name: 'Range Hood', metrics: ['speed'] },
    { id: 'pm25_01', roomId: 'kitchen', type: 'air_quality_sensor', name: 'Kitchen Air Quality', metrics: ['pm25', 'co2'] },
    { id: 'dining_light_01', roomId: 'dining_room', type: 'light', name: 'Dining Light', metrics: ['power', 'brightness'] },
    { id: 'master_sleep_01', roomId: 'master_bedroom', type: 'sleep_sensor', name: 'Master Sleep Sensor', metrics: ['in_bed'] },
    { id: 'child_sleep_01', roomId: 'child_bedroom', type: 'sleep_sensor', name: 'Child Sleep Sensor', metrics: ['in_bed'] },
    { id: 'study_co2_01', roomId: 'study', type: 'air_quality_sensor', name: 'Study CO2', metrics: ['co2'] },
    { id: 'bathroom_water_01', roomId: 'bathroom', type: 'water_flow_sensor', name: 'Bathroom Water Flow', metrics: ['flow_l_min'] },
    { id: 'water_leak_01', roomId: 'bathroom', type: 'water_leak_sensor', name: 'Bathroom Leak Sensor', metrics: ['leak_detected'] },
    { id: 'water_valve_01', roomId: 'bathroom', type: 'water_valve', name: 'Main Water Valve', metrics: ['valve_open'] },
    { id: 'garden_soil_01', roomId: 'garden', type: 'soil_moisture_sensor', name: 'Garden Soil', metrics: ['moisture_percent'] },
    { id: 'sprinkler_01', roomId: 'garden', type: 'sprinkler', name: 'Garden Sprinkler', metrics: ['valve_open'] }
  ]
};

export function getCatalog(): Catalog {
  return structuredClone(catalog);
}
