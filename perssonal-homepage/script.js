document.getElementById("year").textContent = new Date().getFullYear();

const form = document.getElementById("contact-form");
const status = document.getElementById("form-status");

form.addEventListener("submit", (event) => {
  event.preventDefault();

  let valid = true;
  for (const input of form.querySelectorAll("input, textarea")) {
    const ok = input.checkValidity() && input.value.trim() !== "";
    input.closest(".field").classList.toggle("invalid", !ok);
    if (!ok) valid = false;
  }

  if (!valid) {
    status.textContent = "Please fill in all fields with a valid email.";
    status.className = "form-status error";
    return;
  }

  // Placeholder: no backend yet. Hook this up to a form service (e.g. Formspree) later.
  status.textContent = "Thanks! Your message has been received.";
  status.className = "form-status success";
  form.reset();
});
