// Clerk appearance for the signed-out /app gate. Colors match the landing page.
// headerTitle is the card's "Sign in to Prompt Lab", which duplicates the
// page heading; display:none removes it without a Clerk dashboard change.
export const signInAppearance = {
  layout: { socialButtonsVariant: 'blockButton' },
  variables: {
    colorPrimary: '#C2401F',
    colorBackground: '#101018',
    colorText: '#F0EDE6',
    colorTextSecondary: '#8A8A96',
    colorNeutral: '#F0EDE6',
    colorInputBackground: '#16161F',
    colorInputText: '#F0EDE6',
    fontFamily: "'Outfit', -apple-system, sans-serif",
    borderRadius: '0.75rem',
  },
  elements: {
    headerTitle: { display: 'none' },
    card: {
      backgroundColor: '#101018',
      border: '1px solid rgba(255, 255, 255, 0.06)',
      boxShadow: 'none',
    },
    // Provider artwork includes dark pixels; give it a light surface
    // instead of relying on the card's general text color.
    socialButtonsBlockButton: {
      backgroundColor: '#f0ede6',
      color: '#18181b',
      border: '1px solid #f0ede6',
      '&:hover': { backgroundColor: '#ffffff' },
      '&:focus-visible': { outline: '2px solid #C2401F', outlineOffset: '3px' },
    },
    socialButtonsBlockButtonText: { color: '#18181b' },
  },
};
