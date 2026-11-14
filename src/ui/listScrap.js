import { geocodePostcode } from "./location.js";
import { goTo } from "./navigation.js";

/* ---------- list scrap form ---------- */
export let selectedWeight = "";
export const PHOTO_PLACEHOLDER = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8a2 2 0 0 1 2-2h1.2l.9-1.5A2 2 0 0 1 9.8 3.5h4.4a2 2 0 0 1 1.7 1l.9 1.5H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z"/><circle cx="12" cy="13" r="3.5"/></svg>
  <span>Tap to add a photo</span>
`;

document.getElementById("photoPreview").addEventListener("click", () => {
  document.getElementById("photoInput").click();
});
document.getElementById("photoInput").addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const preview = document.getElementById("photoPreview");
    preview.style.backgroundImage = `url(${reader.result})`;
    preview.innerHTML = "";
  };
  reader.readAsDataURL(file);
});

document.getElementById("weightGroup").addEventListener("click", e => {
  const pill = e.target.closest(".pill");
  if (!pill) return;
  document.querySelectorAll("#weightGroup .pill").forEach(p => p.classList.remove("active"));
  pill.classList.add("active");
  selectedWeight = pill.dataset.weight;
});

document.getElementById("postcode").addEventListener("input", () => {
  document.getElementById("postcode").setCustomValidity("");
});

/* If we already know the homeowner's location (cached, or previously granted),
   prefill the postcode field — only ever touches it while it's still empty. */
export function prefillPostcodeFromLocation() {
  const input = document.getElementById("postcode");
  if (input.value) return;
  const loc = scrapmanSavedLocation();
  if (loc && loc.postcode) input.value = loc.postcode;
}

document.getElementById("listForm").addEventListener("submit", async e => {
  e.preventDefault();

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const postcodeInput = document.getElementById("postcode");
  submitBtn.disabled = true;
  submitBtn.textContent = "Finding your location…";

  const coords = await geocodePostcode(postcodeInput.value);

  submitBtn.disabled = false;
  submitBtn.textContent = "List it — free";

  if (!coords) {
    postcodeInput.setCustomValidity("We couldn't find that postcode — please check it.");
    postcodeInput.reportValidity();
    return;
  }
  postcodeInput.setCustomValidity("");

  const newListing = {
    title: document.getElementById("itemTitle").value,
    type: document.getElementById("metalType").value || "mixed",
    weight: selectedWeight || "small",
    lat: coords.lat,
    lng: coords.lng,
    address: postcodeInput.value.toUpperCase(),
    urgency: document.getElementById("urgency").value,
    contactName: document.getElementById("contactName").value,
    contactPhone: document.getElementById("contactPhone").value
  };

  if (!SCRAPMAN_AUTH_CONFIGURED || !scrapmanSession) {
    alert("Something went wrong — please sign in and try again.");
    return;
  }

  const { data: inserted, error } = await scrapmanDb.from("listings").insert({
    homeowner_id: scrapmanSession.user.id,
    title: newListing.title, metal_type: newListing.type, weight_band: newListing.weight,
    urgency: newListing.urgency, lat: newListing.lat, lng: newListing.lng, address: newListing.address
  }).select().single();
  if (error || !inserted) {
    alert("Couldn't create your listing — please try again.");
    return;
  }
  await scrapmanDb.from("listing_contacts").insert({
    listing_id: inserted.id, contact_name: newListing.contactName, contact_phone: newListing.contactPhone
  });

  e.target.reset();
  document.getElementById("photoPreview").style.backgroundImage = "";
  document.getElementById("photoPreview").innerHTML = PHOTO_PLACEHOLDER;
  document.querySelectorAll("#weightGroup .pill").forEach(p => p.classList.remove("active"));
  selectedWeight = "";
  goTo("confirm");
});

