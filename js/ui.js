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
    input.className = 'article-input block w-full px-4 py-2 text-base text-gray-900 border border-gray-300 rounded-lg bg-white resize-y';
    input.placeholder = 'Title, DOI, or PubMed/ArXiv URL/ID';
    input.rows = 2;
    input.addEventListener('input', function () {
        updateClearButtonVisibility(this);
    });

    // Create and setup the clear button
    const clearButton = document.createElement('button');
    clearButton.className = 'clear-input absolute right-2 top-2 text-gray-400 hover:text-gray-600 hidden';
    clearButton.onclick = function () { clearInput(this); };
    clearButton.innerHTML = '<span class="text-xl">×</span>';

    // Add input and clear button to input container
    inputContainer.appendChild(input);
    inputContainer.appendChild(clearButton);

    // Add input container to the input group
    div.appendChild(inputContainer);

    // Create and setup the remove button
    const removeButton = document.createElement('button');
    removeButton.className = 'remove-input h-auto bg-white hover:bg-red-500 text-gray-600 hover:text-white px-4 rounded-lg transition-colors flex-shrink-0 group relative flex items-center justify-center';
    removeButton.onclick = function () { removeInput(this); };
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

        // Update URL parameters after removing input
        updateUrlWithCurrentInputs().catch(error => {
            console.error('Error updating URL after removing input:', error);
        });
    }
}

function clearInput(button) {
    const textarea = button.parentElement.querySelector('textarea');
    textarea.value = '';
    textarea.focus();
    button.classList.add('hidden');

    // Update URL parameters after clearing input
    updateUrlWithCurrentInputs().catch(error => {
        console.error('Error updating URL after clearing input:', error);
    });
}

function updateClearButtonVisibility(textarea) {
    const clearButton = textarea.parentElement.querySelector('.clear-input');
    if (textarea.value.trim()) {
        clearButton.classList.remove('hidden');
    } else {
        clearButton.classList.add('hidden');
    }
}

function updateRemoveButtons() {
    const inputGroups = document.querySelectorAll('.input-group');
    inputGroups.forEach((group, index) => {
        const removeButton = group.querySelector('.remove-input');
        if (removeButton) {
            removeButton.style.display = inputGroups.length > 1 ? '' : 'none';
        }
    });
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

function showConfirmation(message) {
    // Create overlay notification in top right corner
    const notification = document.createElement('div');
    notification.className = 'fixed top-4 right-4 bg-blue-100 border border-blue-400 text-blue-700 px-4 py-3 rounded-lg shadow-lg z-50 max-w-sm';
    notification.style.animation = 'slideInRight 0.3s ease-out';
    notification.textContent = message;

    // Add to body
    document.body.appendChild(notification);

    // Remove after 3 seconds with fade out animation
    setTimeout(() => {
        notification.style.animation = 'fadeOut 0.3s ease-out';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
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

// Function to add remove button to an input group if it doesn't have one
function ensureRemoveButton(inputGroup) {
    if (!inputGroup.querySelector('.remove-input')) {
        const removeButton = document.createElement('button');
        removeButton.className = 'remove-input h-auto bg-white hover:bg-red-500 text-gray-600 hover:text-white px-4 rounded-lg transition-colors flex-shrink-0 group relative flex items-center justify-center';
        removeButton.onclick = function () { removeInput(this); };
        removeButton.innerHTML = `
            <span class="text-xl">−</span>
            <span class="invisible group-hover:visible absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm py-1 px-2 rounded whitespace-nowrap z-10">Remove</span>
        `;
        inputGroup.appendChild(removeButton);
    }
}

// Function to add a publication to the search inputs
function addToPublicationSearch(title, doi) {
    // Add a new input field
    addInput();

    // Get all input groups and find the last one (the newly added one)
    const inputGroups = document.querySelectorAll('.input-group');
    const lastInputGroup = inputGroups[inputGroups.length - 1];
    const textarea = lastInputGroup.querySelector('.article-input');

    // Set the value to the title (preferred) or DOI if title is not available
    textarea.value = title && title !== "Unknown Title" ? title : doi;

    // Update the clear button visibility
    updateClearButtonVisibility(textarea);

    // Scroll to the new input to show it was added
    textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Show a brief confirmation message
    showConfirmation(`Added "${title}" to publication search`);

    // Update URL parameters with all current inputs (async, non-blocking)
    updateUrlWithCurrentInputs().catch(error => {
        console.error('Error updating URL:', error);
    });

    // Trigger search automatically like DOIs do
    // Import findCommonCitations dynamically to avoid circular dependency
    if (window.findCommonCitations) {
        window.findCommonCitations();
    }
}

// Function to update URL parameters with all current input values
async function updateUrlWithCurrentInputs() {
    try {
        const inputs = document.getElementsByClassName('article-input');
        const nonEmptyInputs = Array.from(inputs).filter(input => input.value.trim() !== '');

        if (nonEmptyInputs.length === 0) {
            // Clear URL parameters if no inputs
            const newUrl = window.location.pathname;
            console.log('UI cleared URL to:', newUrl);
            history.replaceState({}, '', newUrl);
            return;
        }

        // Update the URL with the input values
        // Use 'input' parameters for titles and other identifiers, 'doi' for DOIs
        const params = new URLSearchParams();
        nonEmptyInputs.forEach((input, index) => {
            const value = input.value.trim();
            if (value) {
                // Check if the value looks like a DOI
                if (value.match(/^10\.\d+\/.+/)) {
                    // It's already a DOI, use the existing format
                    params.set(`doi${index + 1}`, value);
                } else {
                    // It's likely a title or other identifier, store as input
                    params.set(`input${index + 1}`, encodeURIComponent(value));
                }
            }
        });

        const newUrl = `${window.location.pathname}?${params.toString()}`;
        console.log('UI updated URL to:', newUrl);
        history.replaceState({}, '', newUrl);
    } catch (error) {
        console.error('Error updating URL with current inputs:', error);
    }
}

// Progress indicator functions
function showProgressIndicator(container, message, currentStep, totalSteps) {
    const progressHtml = `
        <div id="progress-indicator" class="text-center py-8 px-4">
            <div class="inline-block max-w-sm w-full">
                <!-- Animated spinner -->
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4"></div>
                
                <!-- Progress bar -->
                <div class="w-full max-w-64 bg-gray-200 rounded-full h-2 mb-4 mx-auto">
                    <div class="bg-blue-500 h-2 rounded-full transition-all duration-300" style="width: ${(currentStep / totalSteps) * 100}%"></div>
                </div>
                
                <!-- Progress text -->
                <div class="text-gray-700 font-medium mb-2 text-sm sm:text-base" id="progress-message">${message}</div>
                <div class="text-xs sm:text-sm text-gray-500" id="progress-steps">Step ${currentStep} of ${totalSteps}</div>
            </div>
        </div>
    `;

    if (typeof container === 'string') {
        document.getElementById(container).innerHTML = progressHtml;
    } else {
        container.innerHTML = progressHtml;
    }
}

function updateProgressIndicator(message, currentStep, totalSteps) {
    const progressMessage = document.getElementById('progress-message');
    const progressSteps = document.getElementById('progress-steps');
    const progressBar = document.querySelector('#progress-indicator .bg-blue-500');

    if (progressMessage) progressMessage.textContent = message;
    if (progressSteps) progressSteps.textContent = `Step ${currentStep} of ${totalSteps}`;
    if (progressBar) progressBar.style.width = `${(currentStep / totalSteps) * 100}%`;
}

function clearProgressIndicator() {
    const progressIndicator = document.getElementById('progress-indicator');
    if (progressIndicator) {
        progressIndicator.remove();
    }
}

export {
    addInput,
    removeInput,
    clearInput,
    updateClearButtonVisibility,
    updateRemoveButtons,
    ensureRemoveButton,
    updateInputWithTitle,
    copyToClipboard,
    showError,
    showConfirmation,
    addToPublicationSearch,
    updateUrlWithCurrentInputs,
    showProgressIndicator,
    updateProgressIndicator,
    clearProgressIndicator
};
