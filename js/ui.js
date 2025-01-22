async function addInput() {
    const container = document.getElementById('inputContainer');
    
    // Create the input group container
    const div = document.createElement('div');
    div.className = 'input-group flex gap-2 w-full max-w-[800px] px-4 sm:px-0';
    
    // Create the input container
    const inputContainer = document.createElement('div');
    inputContainer.className = 'relative flex-grow';
    
    // Create and setup the textarea
    const input = document.createElement('textarea');
    input.className = 'article-input block w-full px-4 py-2 text-base text-gray-900 border border-gray-300 rounded-lg bg-gray-50 resize-y';
    input.placeholder = 'Title, DOI, or PubMed/ArXiv URL/ID';
    input.rows = 2;
    input.addEventListener('input', function() {
        updateClearButtonVisibility(this);
    });
    
    // Create and setup the clear button
    const clearButton = document.createElement('button');
    clearButton.className = 'clear-input absolute right-2 top-2 text-gray-400 hover:text-gray-600 hidden';
    clearButton.onclick = function() { clearInput(this); };
    clearButton.innerHTML = '<span class="text-xl">×</span>';
    
    // Add input and clear button to input container
    inputContainer.appendChild(input);
    inputContainer.appendChild(clearButton);
    
    // Add input container to the input group
    div.appendChild(inputContainer);
    
    // Create and setup the remove button
    const removeButton = document.createElement('button');
    removeButton.className = 'remove-input h-auto bg-white hover:bg-red-500 text-gray-600 hover:text-white px-4 rounded-lg transition-colors flex-shrink-0 group relative flex items-center justify-center';
    removeButton.onclick = function() { removeInput(this); };
    removeButton.innerHTML = `
        <span class="text-xl">−</span>
        <span class="invisible group-hover:visible absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm py-1 px-2 rounded whitespace-nowrap z-10">Remove</span>
    `;
    
    // Add remove button to input group
    div.appendChild(removeButton);
    
    // Add the new input group to the container
    container.appendChild(div);
    
    // Update remove buttons after adding new input
    updateRemoveButtons();
}

function removeInput(button) {
    const inputContainer = document.getElementById('inputContainer');
    const inputGroups = inputContainer.querySelectorAll('.input-group');
    
    // Only remove if there's more than one input group
    if (inputGroups.length > 1) {
        const inputGroup = button.closest('.input-group');
        inputGroup.remove();
        // Update remove buttons after removing input
        updateRemoveButtons();
    }
}

function clearInput(button) {
    const textarea = button.parentElement.querySelector('textarea');
    textarea.value = '';
    textarea.focus();
    button.classList.add('hidden');
}

function updateClearButtonVisibility(textarea) {
    const clearButton = textarea.parentElement.querySelector('.clear-input');
    if (textarea.value.trim()) {
        clearButton.classList.remove('hidden');
    } else {
        clearButton.classList.add('hidden');
    }
}

// Helper function to update input field with title
async function updateInputWithTitle(input, title) {
    if (title && title !== "Unknown Title") {
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
        const messageEl = document.getElementById(`copyMessage-${text}`);
        messageEl.style.opacity = '1';
        setTimeout(() => {
            messageEl.style.opacity = '0';
        }, 1500);
    } catch (err) {
        showError('Failed to copy DOI');
    }
}

export {
    addInput, 
    removeInput, 
    clearInput, 
    updateClearButtonVisibility,
    updateInputWithTitle,
    copyToClipboard,
    showError 
};
