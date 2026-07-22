document.addEventListener("DOMContentLoaded", () => {
  const carousel = document.querySelector(".plan-carousel");
  if (!carousel) return;
  const track = carousel.querySelector(".plan-carousel-track");
  const slides = [...carousel.querySelectorAll(".plan-slide")];
  const dots = carousel.querySelector(".plan-carousel-dots");
  let page = 0;
  let timer;

  carousel.querySelectorAll(".matrix-plan-table tbody tr").forEach(row => {
    const cells = [...row.children];
    const labels = ["Level", "Unlock requirement", "Your action", "Passive income", "Products Plus", "Matrix income"];
    cells.forEach((cell, index) => cell.dataset.label = labels[index]);
    if (cells[1] && /^3\s/.test(cells[1].textContent.trim())) cells[1].textContent = `Your ${cells[1].textContent.trim()}`;
    cells.slice(3).forEach((cell, rewardIndex) => {
      const raw = cell.textContent.trim();
      const [amount, duration] = raw.split("·").map(value => value.trim());
      const rewardNames = ["Passive", "Products Plus", "Matrix"];
      cell.classList.add("plan-reward", `plan-reward-${rewardIndex + 1}`);
      if (raw === "—") {
        cell.innerHTML = `<span class="plan-reward-name">${rewardNames[rewardIndex]}</span><strong>Not included</strong>`;
        return;
      }
      cell.innerHTML = `<span class="plan-reward-name">${rewardNames[rewardIndex]}</span><strong>${amount}</strong>${duration ? `<span class="plan-month-badge">${duration.replace("mo.", "months")}</span>` : ""}`;
    });
  });

  dots.innerHTML = slides.map((_, index) => `<button type="button" aria-label="Show schedule page ${index + 1}" data-plan-page="${index}"></button>`).join("");
  const render = () => {
    track.style.transform = `translateX(-${page * 100}%)`;
    dots.querySelectorAll("button").forEach((dot, index) => {
      dot.classList.toggle("active", index === page);
      dot.setAttribute("aria-current", index === page ? "true" : "false");
    });
  };
  const move = direction => { page = (page + direction + slides.length) % slides.length; render(); restart(); };
  const restart = () => {
    window.clearInterval(timer);
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) timer = window.setInterval(() => move(1), 8000);
  };
  carousel.querySelector("[data-plan-prev]").addEventListener("click", () => move(-1));
  carousel.querySelector("[data-plan-next]").addEventListener("click", () => move(1));
  dots.addEventListener("click", event => {
    const button = event.target.closest("[data-plan-page]");
    if (!button) return;
    page = Number(button.dataset.planPage); render(); restart();
  });
  carousel.addEventListener("mouseenter", () => window.clearInterval(timer));
  carousel.addEventListener("mouseleave", restart);
  render(); restart();

  const mobileGallery = document.querySelector(".mobile-plan-gallery");
  if (!mobileGallery) return;
  const mobileTrack = mobileGallery.querySelector(".mobile-plan-gallery-track");
  const mobileSlides = [...mobileGallery.querySelectorAll(".mobile-plan-image-slide")];
  const mobileDots = mobileGallery.querySelector(".mobile-plan-gallery-dots");
  let mobilePage = 0;
  let scrollTimer;
  mobileDots.innerHTML = mobileSlides.map((_, index) => `<button type="button" aria-label="Show plan image ${index + 1}" data-mobile-plan-page="${index}"></button>`).join("");
  const renderMobile = (scroll = true) => {
    mobileDots.querySelectorAll("button").forEach((dot, index) => {
      dot.classList.toggle("active", index === mobilePage);
      dot.setAttribute("aria-current", index === mobilePage ? "true" : "false");
    });
    if (scroll) mobileTrack.scrollTo({ left: mobilePage * mobileTrack.clientWidth, behavior: "smooth" });
  };
  const moveMobile = direction => {
    mobilePage = (mobilePage + direction + mobileSlides.length) % mobileSlides.length;
    renderMobile();
  };
  mobileGallery.querySelector("[data-mobile-plan-prev]").addEventListener("click", () => moveMobile(-1));
  mobileGallery.querySelector("[data-mobile-plan-next]").addEventListener("click", () => moveMobile(1));
  mobileDots.addEventListener("click", event => {
    const button = event.target.closest("[data-mobile-plan-page]");
    if (!button) return;
    mobilePage = Number(button.dataset.mobilePlanPage);
    renderMobile();
  });
  mobileTrack.addEventListener("scroll", () => {
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      mobilePage = Math.round(mobileTrack.scrollLeft / mobileTrack.clientWidth);
      renderMobile(false);
    }, 80);
  }, { passive: true });
  renderMobile(false);
});
