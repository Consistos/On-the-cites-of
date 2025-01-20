function addInput() {
    const container = document.getElementById('inputContainer');
    const inputGroups = container.getElementsByClassName('input-group');
    const lastInputGroup = inputGroups[inputGroups.length - 1];
    
    // Clone the last input group
    const newInputGroup = lastInputGroup.cloneNode(true);
    
    // Clear the value of the textarea in the new group
    const textarea = newInputGroup.querySelector('textarea');
    textarea.value = '';
    
    // Add event listeners to the new textarea
    textarea.addEventListener('input', () => updateClearButtonVisibility(textarea));
    textarea.addEventListener('keypress', function(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            findCommonCitations();
        }
    });
    
    // Update clear button visibility
    const clearButton = newInputGroup.querySelector('.clear-input');
    clearButton.style.display = 'none';
    clearButton.onclick = () => clearInput(clearButton);
    
    // Add the new input group to the container
    container.appendChild(newInputGroup);
    
    // Ensure remove button exists and is properly set up
    ensureRemoveButton(newInputGroup);
    
    // Update the visibility of remove buttons
    updateRemoveButtons();
    
    // Focus the new textarea
    textarea.focus();
}

function removeInput(button) {
    const inputGroup = button.closest('.input-group');
    if (inputGroup) {
        inputGroup.remove();
        updateRemoveButtons();
    }
}

function clearInput(button) {
    const textarea = button.closest('.relative').querySelector('textarea');
    textarea.value = '';
    updateClearButtonVisibility(textarea);
}

function updateClearButtonVisibility(textarea) {
    const clearButton = textarea.parentElement.querySelector('.clear-input');
    if (clearButton) {
        clearButton.style.display = textarea.value.trim() ? 'block' : 'none';
    }
}

function updateRemoveButtons() {
    const container = document.getElementById('inputContainer');
    const inputGroups = container.getElementsByClassName('input-group');
    
    Array.from(inputGroups).forEach((group, index) => {
        const removeButton = group.querySelector('.remove-input');
        if (removeButton) {
            removeButton.style.display = inputGroups.length > 2 ? 'block' : 'none';
        }
    });
}

function ensureRemoveButton(inputGroup) {
    if (!inputGroup.querySelector('.remove-input')) {
        const removeButton = document.createElement('button');
        removeButton.className = 'remove-input h-auto bg-white hover:bg-red-500 text-gray-600 hover:text-white px-4 rounded-lg transition-colors flex-shrink-0 group relative flex items-center justify-center';
        removeButton.onclick = function() { removeInput(this); };
        removeButton.innerHTML = `
            <span class="text-xl">−</span>
            <span class="invisible group-hover:visible absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm py-1 px-2 rounded whitespace-nowrap z-10">Remove</span>
        `;
        inputGroup.appendChild(removeButton);
    }
}

async function updateInputWithTitle(input, title) {
    if (input.value.trim() !== title) {
        input.value = title;
        updateClearButtonVisibility(input);
    }
}

function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
    setTimeout(() => {
        errorDiv.classList.add('hidden');
    }, 3000);
}

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        const notification = document.createElement('div');
        notification.className = 'fixed bottom-4 right-4 bg-green-500 text-white px-4 py-2 rounded shadow-lg';
        notification.textContent = 'DOI copied to clipboard';
        document.body.appendChild(notification);
        setTimeout(() => {
            notification.remove();
        }, 1500);
    } catch (err) {
        showError('Failed to copy DOI');
    }
}

const addInputButton = document.getElementById('addInputButton');
addInputButton.className = 'bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded';

export { 
    addInput, 
    removeInput, 
    clearInput, 
    updateClearButtonVisibility, 
    updateRemoveButtons, 
    ensureRemoveButton,
    updateInputWithTitle,
    copyToClipboard,
    showError 
};
