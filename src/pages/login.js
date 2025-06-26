
const loginButton = document.getElementById('loginButton');
const statusText = document.getElementById('status');


loginButton.addEventListener('click', () => {

    statusText.classList.remove("hidden");
    statusText.textContent = 'Giriş penceresi açılıyor...';
    window.electron.startRiotLogin();
});

window.electron.onLoginSuccess((data) => {
    try{
        data = JSON.parse(JSON.stringify(data));
    }catch(e){
        console.log(e);
    }
    statusText.textContent = 'Başarıyla giriş yapıldı!';

    window.electron.saveTokens({
        accessToken: data.accessToken,
        idToken: data.idToken
    });

});
