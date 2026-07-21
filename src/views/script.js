document.getElementById('current_date').textContent = new Date().toLocaleDateString('en-GB');

// Initialize employee data
let employee_id = null;
let employeeData = null;

const initializeEmployee = async () => {
    // Try to get from sessionStorage first
    const stored = sessionStorage.getItem('employeeData');
    if (stored) {
        employeeData = JSON.parse(stored);
    } else {
        // Fallback to API call
        try {
            const response = await fetch('/api/employee');
            const data = await response.json();
            if (data.success) {
                employeeData = data.employee;
                sessionStorage.setItem('employeeData', JSON.stringify(employeeData));
            }
        } catch (err) {
            console.error('Error fetching employee data:', err);
        }
    }

    // Display employee name
    if (employeeData) {
        employee_id = employeeData.id;
        document.getElementById('employee_name_display').textContent = employeeData.name || "Employee";
    } else {
        document.getElementById('employee_name_display').textContent = "Employee";
    }
};

initializeEmployee();

// Set up date
const date_n = new Date().toLocaleDateString('en-GB');
const date_input = date_n;

// Library button
document.getElementById('library_section')?.addEventListener('click', () => {
    window.location.href = '/library';
});

// Toggle checklist for SC5 page
document.querySelectorAll('.button_checklist_container').forEach(container => {
    container.addEventListener('click', () => {
        const img = container.querySelector('.check_img');
        const input = container.parentElement.querySelector('input');

        if (img.style.display === 'none') {
            img.style.display = 'block';
            input.value = 'yes';
        } else {
            img.style.display = 'none';
            input.value = 'no';
        }
    });
});

// Library button
document.getElementById('library_section')?.addEventListener('click', () => {
    window.location.href = '/library';
});

// // Initialize table when DOM is loaded
// if (document.getElementById('table_body')) {
//     initializeSC5Table();
// }

