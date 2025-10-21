export const quickPollRemoteDomScript = `
// Remote DOM script for quick-poll widget
// Note: Remote DOM only supports registered MCP-UI components like ui-stack, ui-text, ui-button
// Standard HTML elements (div, h2, p, etc.) are NOT available

// Get props (passed from tool parameters)
const props = ${JSON.stringify({ question: 'What is your favorite framework?', options: ['React', 'Vue', 'Svelte', 'Angular'] })};

// Create main container stack (vertical layout)
const container = document.createElement('ui-stack');
container.setAttribute('direction', 'column');
container.setAttribute('spacing', 'medium');
container.setAttribute('padding', 'large');

// Title text
const title = document.createElement('ui-text');
title.setAttribute('size', 'xlarge');
title.setAttribute('weight', 'bold');
title.textContent = '📊 Quick Poll';
container.appendChild(title);

// Description text
const description = document.createElement('ui-text');
description.textContent = 'Cast your vote below!';
container.appendChild(description);

// Question text
const questionText = document.createElement('ui-text');
questionText.setAttribute('size', 'large');
questionText.setAttribute('weight', 'semibold');
questionText.textContent = props.question || 'What is your preference?';
container.appendChild(questionText);

// Button stack (horizontal layout)
const buttonStack = document.createElement('ui-stack');
buttonStack.setAttribute('direction', 'row');
buttonStack.setAttribute('spacing', 'small');
buttonStack.setAttribute('wrap', 'true');

// Create vote tracking
const votes = {};
let feedbackText = null;

// Create buttons for each option
const options = props.options || ['Option 1', 'Option 2', 'Option 3'];
options.forEach((option) => {
  const button = document.createElement('ui-button');
  button.setAttribute('label', option);
  button.setAttribute('variant', 'secondary');

  button.addEventListener('press', () => {
    // Record vote
    votes[option] = (votes[option] || 0) + 1;

    // Send vote to parent (for tracking)
    window.parent.postMessage({
      type: 'tool',
      payload: {
        toolName: 'record_vote',
        params: {
          question: props.question,
          selected: option,
          votes: votes
        }
      }
    }, '*');

    // Update or create feedback text
    if (feedbackText) {
      feedbackText.textContent = \`✓ Voted for \${option}! (Total votes: \${votes[option]})\`;
    } else {
      feedbackText = document.createElement('ui-text');
      feedbackText.setAttribute('emphasis', 'high');
      feedbackText.textContent = \`✓ Voted for \${option}!\`;
      container.appendChild(feedbackText);
    }
  });

  buttonStack.appendChild(button);
});

container.appendChild(buttonStack);

// Results section
const resultsTitle = document.createElement('ui-text');
resultsTitle.setAttribute('size', 'medium');
resultsTitle.setAttribute('weight', 'semibold');
resultsTitle.textContent = 'Vote to see results!';
container.appendChild(resultsTitle);

// Append to root
root.appendChild(container);
  `