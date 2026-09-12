const SECTION_OPTIONS = [
    { id: 'butcher', title: 'Butcher Area' },
    { id: 'kitchen', title: 'Kitchen' },
    { id: 'blue_room', title: 'Blue Room' },
    { id: 'dough_room', title: 'Dough Room' },
    { id: 'storeroom', title: 'Storeroom' },
    { id: 'toilet', title: 'Toilet' },
    { id: 'cold_room', title: 'Cold Room' },
    { id: 'coffee_area', title: 'Front/Coffee Area' },
    { id: 'shop_floor', title: 'Shop Floor' }
];

// Maps the app's section ids to the `cleaning_area` radio group's state
// names in templates/unclesmarket_checklist.pdf (confirmed via
// `pdftk unclesmarket_checklist.pdf dump_data_fields`).
const SECTION_PDF_STATE = {
    butcher: 'butcher_area',
    kitchen: 'kitchen_area',
    blue_room: 'blue_room',
    dough_room: 'dough_room',
    storeroom: 'store_room',
    toilet: 'toilet',
    cold_room: 'cold_room',
    coffee_area: 'front_area',
    shop_floor: 'shop_floor'
};

const TASKS = [
    'Surface / Area',
    'Sink',
    'Floor',
    'Table / Desk',
    'Shelves',
    'Under Shelves'
];

module.exports = { SECTION_OPTIONS, SECTION_PDF_STATE, TASKS };
